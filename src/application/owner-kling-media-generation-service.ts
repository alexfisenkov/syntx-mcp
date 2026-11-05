import { OWNER_KLING_MEDIA_CURRENT_CONTROLS } from "./owner-kling-media-current-controls.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { PerUserLinkService } from "../auth/link-service.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { readOwnerKlingMediaChat, type OwnerKlingMediaChatContext } from "../adapter/syntx/owner-kling-media-chat-context.js";
import { isOwnerKlingMediaReferenceService, type OwnerKlingMediaReferenceService, type OwnerKlingMediaResolvedReference } from "./owner-kling-media-reference-service.js";
import { buildOwnerKlingMediaWire, type OwnerKlingMediaWireCandidate } from "./owner-kling-media-wire.js";
import { getOwnerKlingMediaSourceProfile, normalizeOwnerKlingMediaParameters,
  type OwnerKlingMediaModelId, type OwnerKlingMediaParametersInput } from "./owner-kling-media-parameters.js";

const MODEL_IDS = ["kling_elements", "kling_o1_image2video", "kling_o1_video2video"] as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^kling_media_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const FRESH_MS = 15_000;
const MAX_RECORDS = 128;
const OPERATIONS = new WeakMap<object, Operation>();
const RESULTS = new WeakMap<object, { readonly operation: Operation; readonly row: HistoryRow }>();
const SERVICES = new WeakSet<object>();
const inputSchema = z.union([
  z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal("kling_elements"), prompt: z.string().min(1).max(1_000), version: z.literal("1.6"),
    mode: z.literal("hd"), aspect_ratio: z.literal("16:9"), video_duration: z.literal(5), native_audio: z.literal(false), reference_handle: z.string().regex(/^kling_media_reference_[0-9a-f-]{36}$/u) }).strict(),
  z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_image2video"), prompt: z.string().min(1).max(1_000), version: z.literal("1.6"),
    mode: z.literal("hd"), aspect_ratio: z.literal("16:9"), video_duration: z.literal(5), native_audio: z.literal(false), reference_handle: z.string().regex(/^kling_media_reference_[0-9a-f-]{36}$/u) }).strict(),
  z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_video2video"), prompt: z.string().min(1).max(1_000), version: z.literal("1.6"),
    mode: z.literal("hd"), video_duration: z.literal(5), native_audio: z.literal(false), reference_handle: z.string().regex(/^kling_media_reference_[0-9a-f-]{36}$/u) }).strict(),
  z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal("kling_elements"), prompt: currentPrompt(), version: z.literal("3.0"),
    mode: z.enum(["standart", "hd", "4K"]), aspect_ratio: z.enum(["16:9", "1:1", "9:16"]), video_duration: z.number().finite().min(3).max(15),
    native_audio: z.boolean(), multi_shots: z.boolean(), reference_handles: currentHandles(7) }).strict(),
  z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_image2video"), prompt: currentPrompt(), mode: z.literal("hd"),
    aspect_ratio: z.enum(["16:9", "1:1", "9:16"]), video_duration: z.number().finite().min(3).max(10), reference_handles: currentHandles(4) }).strict(),
  z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.literal("kling_o1_video2video"), prompt: currentPrompt(), mode: z.literal("hd"),
    reference_handles: currentHandles(5) }).strict()
]);
function currentPrompt() { return z.string().min(1).max(1000).refine(value => !!value.trim() && !/[\p{Cs}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)); }
function currentHandles(maximum: number) { return z.array(z.string().regex(/^kling_media_reference_[0-9a-f-]{36}$/u)).min(1).max(maximum)
  .refine(value => new Set(value).size === value.length); }
const idSchema = z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const objectSchema = z.object({ id: idSchema, message_id: idSchema, object_type: z.string().max(128), object_text: z.string().max(20_000).nullable().optional(),
  object_url: z.string().max(4096).nullable().optional(), model_type: z.string().max(160).nullable().optional(), completed: z.boolean().nullable().optional() }).strip();
const rowSchema = z.object({ id: idSchema, chat_id: idSchema, author_id: z.number().int().safe(), message_object: z.array(objectSchema).max(64) }).strip();
const historySchema = z.object({ messages: z.array(rowSchema).max(10), pagination: z.object({ page: z.literal(1), page_size: z.literal(10),
  total_count: z.number().int().min(0).max(10), total_pages: z.number().int().min(0).max(1), has_next: z.boolean(), has_previous: z.boolean() }).strip() }).strip();
type HistoryRow = z.infer<typeof rowSchema>;
type Request = Readonly<{ attemptId: string; model_id: OwnerKlingMediaModelId; prompt: string;
  version?: "1.6" | "3.0"; mode: "standart" | "hd" | "4K"; aspect_ratio?: "16:9" | "1:1" | "9:16";
  video_duration?: number; native_audio?: boolean; multi_shots?: boolean;
  reference_handle?: string; reference_handles?: readonly string[] }>;

export interface OwnerKlingMediaRuntimeCatalog { readonly catalog: DiscoveryCatalogRepository; readonly catalog_version: string }
export function loadOwnerKlingMediaRuntimeCatalog(catalogDirectory?: string): Readonly<OwnerKlingMediaRuntimeCatalog> {
  try {
    const profile = getOwnerKlingMediaSourceProfile(), snapshot = loadPublicCatalogVersion(profile.source_pins.public_catalog_version, catalogDirectory);
    const catalog = new DiscoveryCatalogRepository(snapshot), ai = snapshot.ai.find(item => item.value === "kling");
    if (!ai?.active || ai.scope !== "video") throw new Error("MODEL_BINDING_MISMATCH");
    for (const modelId of MODEL_IDS) {
      const model = catalog.getModel(modelId), settings = model.settings;
      const video = modelId === "kling_o1_video2video";
      const expectedTypes = video ? ["video/mp4", "video/quicktime", "image/jpeg", "image/png", "image/avif", "image/webp"] :
        ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"];
      const expectedMedia = video ? ["videos", "images"] : ["images"];
      const expectedCount = modelId === "kling_elements" ? 7 : modelId === "kling_o1_image2video" ? 4 : { images: 4, videos: 1 };
      if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "kling" || !settings ||
          !Array.isArray(settings.get_cost_params) || schemaHash(settings.get_cost_params) !== schemaHash(profile.cost_query_keys[modelId]) ||
          settings.uploadable !== true || settings.max_file_size !== (video || modelId === "kling_elements" ? 0 : 31_457_280) ||
          schemaHash(Array.isArray(settings.accepted_file_types) ? [...settings.accepted_file_types].sort() : []) !== schemaHash([...expectedTypes].sort()) ||
          schemaHash(settings.allowed_media_types) !== schemaHash(expectedMedia) || schemaHash(settings.file_count_limit) !== schemaHash(expectedCount) ||
          (video && (settings.min_video_duration !== 3 || settings.max_video_duration !== 10 || settings.hdr_video_support !== false))) {
        throw new Error("MODEL_BINDING_MISMATCH");
      }
    }
    return Object.freeze({ catalog, catalog_version: profile.source_pins.public_catalog_version });
  } catch { throw new OwnerKlingMediaGenerationError("MODEL_BINDING_MISMATCH"); }
}

export interface OwnerKlingMediaGenerationOptions { readonly binding: AuthBinding; readonly linkService: PerUserLinkService;
  readonly referenceService: OwnerKlingMediaReferenceService; readonly catalog: DiscoveryCatalogRepository; readonly catalogDirectory?: string;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient; readonly resolveChatClient: (attemptId: string) => unknown; readonly now: () => number }
export interface OwnerKlingMediaArtifact { readonly message_object_id: string; readonly object_type: "video"; readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null; readonly message_id: string; readonly chat_uuid: string; readonly model_id: OwnerKlingMediaModelId }
export interface OwnerKlingMediaGenerationResult { readonly status: "completed" | "outcome_unknown"; readonly recovery_id: string;
  readonly model_id: OwnerKlingMediaModelId; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false; readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number; readonly artifacts: readonly OwnerKlingMediaArtifact[]; readonly gaps: readonly string[] }
export class OwnerKlingMediaGenerationError extends Error {
  constructor(readonly code: string, readonly recovery_id?: string) { super("The owner Kling media generation could not be completed safely."); this.name = "OwnerKlingMediaGenerationError"; }
}
interface Operation { readonly token: object; readonly request: Request; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly owned: readonly OwnerKlingMediaResolvedReference[]; readonly parameters: OwnerKlingMediaParametersInput; wire: Readonly<OwnerKlingMediaWireCandidate>; readonly recovery_id: string;
  readonly semantic: string; readonly epoch: number; phase: "PREPARING" | "READY" | "POSTED"; invalid: boolean;
  chat?: OwnerKlingMediaChatContext; ack?: string; owner_echo?: string; provider_chat?: string; quote_at: number;
  result: OwnerKlingMediaGenerationResult; validate(dispatch: boolean): void; }

/** One exact Kling media POST with fresh access/price preflights and process-local GET-only recovery. */
export class OwnerKlingMediaGenerationService {
  readonly #o: OwnerKlingMediaGenerationOptions; readonly #records = new Map<string, Operation>(); readonly #claims = new Set<string>();
  readonly #busy = new Set<string>(); readonly #epochs = new Map<string, number>();
  readonly #pending = new Map<Promise<unknown>, { readonly attempt: string; readonly abort: AbortController }>();
  #currentCatalog: DiscoveryCatalogRepository | undefined;
  #closed = false; #lastTime = 0;
  constructor(options: OwnerKlingMediaGenerationOptions) {
    if (!options || types.isProxy(options) || !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !isOwnerKlingMediaReferenceService(options.referenceService) || !genuine(options.catalog, DiscoveryCatalogRepository, ["getModel"]) ||
        typeof options.createReadClient !== "function" || typeof options.resolveChatClient !== "function" || typeof options.now !== "function") fail("INVALID_REQUEST");
    const pinned = loadOwnerKlingMediaRuntimeCatalog(options.catalogDirectory).catalog;
    if (options.catalog.fetched_at !== pinned.fetched_at || MODEL_IDS.some(id => schemaHash(options.catalog.getModel(id)) !== schemaHash(pinned.getModel(id))) ||
        schemaHash(options.catalog.source_hashes) !== schemaHash(pinned.source_hashes)) fail("MODEL_BINDING_MISMATCH");
    this.#o = Object.freeze({ ...options, binding: Object.freeze({ ...options.binding }) }); this.#time(); SERVICES.add(this); Object.freeze(this);
  }
  generate(input: unknown, signal?: AbortSignal): Promise<OwnerKlingMediaGenerationResult> {
    let request: Request; try { const parsed = inputSchema.parse(snapshot(input)); request = Object.freeze({ ...parsed, ...("reference_handles" in parsed ? { reference_handles: Object.freeze([...parsed.reference_handles]) } : {}) }) as Request; } catch { return Promise.reject(new OwnerKlingMediaGenerationError("INVALID_REQUEST")); }
    try { if (request.version === "1.6" || request.model_id !== "kling_o1_video2video") normalizeOwnerKlingMediaParameters(parameterInput(request)); }
    catch { return Promise.reject(new OwnerKlingMediaGenerationError("INVALID_REQUEST")); }
    return this.#run(request.attemptId, signal, deadline => this.#generate(request, deadline));
  }
  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerKlingMediaGenerationResult> {
    let f: Record<string, unknown>; try { f = exact(input, ["attemptId", "recovery_id"]); } catch (e) { return Promise.reject(e); }
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) return Promise.reject(new OwnerKlingMediaGenerationError("INVALID_REQUEST"));
    return this.#run(f.attemptId, signal, async deadline => { const op = this.#records.get(f.recovery_id as string);
      if (!op || op.request.attemptId !== f.attemptId) fail("RECOVERY_NOT_FOUND"); await this.#current(op, deadline, false); op.validate(false);
      if (op.phase !== "POSTED" || op.result.status === "completed") return op.result; return this.#collect(op, deadline); });
  }
  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerKlingMediaGenerationResult[]> {
    let f: Record<string, unknown>; try { f = exact(input, ["attemptId"]); } catch (e) { return Promise.reject(e); }
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) return Promise.reject(new OwnerKlingMediaGenerationError("INVALID_REQUEST"));
    return this.#run(f.attemptId, signal, async deadline => { const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#o.binding,
      attemptId: f.attemptId as string, linkService: this.#o.linkService }));
      return Object.freeze([...this.#records.values()].filter(op => !op.invalid && op.request.attemptId === f.attemptId && sameGenerationPrincipal(op.principal, principal)).map(op => op.result)); });
  }
  async invalidateAttempt(attempt: string): Promise<void> { if (!ATTEMPT.test(attempt)) return; this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const op of this.#records.values()) if (op.request.attemptId === attempt) { op.invalid = true; try { callNative(op.client, "invalidateOwnerKlingMediaChats", [attempt]); } catch {} }
    const pending = [...this.#pending].filter(([, row]) => row.attempt === attempt); for (const [, row] of pending) row.abort.abort();
    await Promise.allSettled(pending.map(([promise]) => promise));
    for (const [id, op] of this.#records) if (op.request.attemptId === attempt) this.#records.delete(id);
    await this.#o.referenceService.invalidateAttempt(attempt); }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true;
    for (const op of this.#records.values()) { op.invalid = true; try { callNative(op.client, "invalidateOwnerKlingMediaChats", [op.request.attemptId]); } catch {} }
    for (const row of this.#pending.values()) row.abort.abort(); await Promise.allSettled([...this.#pending.keys()]);
    this.#records.clear(); this.#claims.clear(); await this.#o.referenceService.close(); }

  async #generate(request: Request, deadline: AbsoluteRequestDeadline): Promise<OwnerKlingMediaGenerationResult> {
    const epoch = this.#epochs.get(request.attemptId) ?? 0;
    try {
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#o.binding, attemptId: request.attemptId, linkService: this.#o.linkService }));
      const owned: OwnerKlingMediaResolvedReference[] = [];
      for (const handle of request.reference_handles ?? [request.reference_handle!]) {
        let row: OwnerKlingMediaResolvedReference;
        try { row = await deadline.waitFor(this.#o.referenceService.resolve({ attemptId: request.attemptId, model_id: request.model_id, reference_handle: handle })); }
        catch { deadline.throwIfAborted(); return fail("REFERENCE_UNAVAILABLE"); }
        if (!this.#o.referenceService.isOwnedReference(row) || !sameGenerationPrincipal(principal, row.principal)) fail("REFERENCE_UNAVAILABLE");
        owned.push(row);
      }
      const current = request.version !== "1.6";
      if (current) validateCurrentReferences(request.model_id, owned);
      const measured = owned.find(row => row.type === "video")?.duration_seconds;
      const parameters = parameterInput(request, measured === undefined || measured === null ? undefined : Math.round(measured));
      const normalized = normalizeOwnerKlingMediaParameters(parameters);
      let capturedClient: SyntxChatHttpClient | undefined;
      const references = owned.map(row => this.#o.referenceService.withCapturedReference(row, (client, reference) => {
        if (capturedClient && capturedClient !== client) fail("REFERENCE_UNAVAILABLE"); capturedClient = client; return reference;
      }));
      if (!capturedClient) fail("REFERENCE_UNAVAILABLE");
      const captured = { client: capturedClient, wire: buildOwnerKlingMediaWire(normalized, { chat_uuid: "chat_pending", references }) };
      const semantic = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, intent: captured.wire.intent_fingerprint });
      if (this.#claims.has(semantic)) fail("INTENT_ALREADY_CLAIMED"); if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#validateClient(captured.client);
      this.#claims.add(semantic);
      const recovery_id = `kling_media_recovery_${randomUUID()}`, token = Object.freeze({ model_id: request.model_id });
      let op!: Operation;
      op = { token, request, principal, client: captured.client, owned: Object.freeze(owned), parameters, wire: captured.wire, recovery_id, semantic, epoch, phase: "PREPARING",
        invalid: false, quote_at: 0, result: unknown(request.model_id, recovery_id, ["NOT_DISPATCHED"]), validate: dispatch => this.#validateOperation(op, dispatch) };
      OPERATIONS.set(token, op);
      try { await this.#preflight(op, deadline); op.validate(true); }
      catch (error) { this.#claims.delete(semantic); throw error; }
      this.#records.set(recovery_id, op);
      try { op.chat = await deadline.waitFor(callNative(op.client, "createOwnerKlingMediaChat", [{ attemptId: request.attemptId,
        model_id: request.model_id, title: `owner-kling-media-${randomUUID()}` }, deadline.signal])) as OwnerKlingMediaChatContext; }
      catch { return this.#unknown(op, "CHAT_CREATE_OUTCOME_UNKNOWN"); }
      if (readOwnerKlingMediaChat(op.client, op.chat, request.attemptId)?.model_id !== request.model_id) return this.#unknown(op, "CHAT_CONTEXT_UNVERIFIED");
      const refs = owned.map(row => this.#o.referenceService.withCapturedReference(row, (client, media) => {
        if (client !== op.client) fail("REFERENCE_UNAVAILABLE"); return media;
      }));
      op.wire = buildOwnerKlingMediaWire(normalizeOwnerKlingMediaParameters(parameters), { chat_uuid: op.chat.chat_uuid, references: refs });
      await this.#preflight(op, deadline); op.validate(true); op.phase = "READY";
      try {
        const ack = await deadline.waitFor(callNative(op.client, "startOwnerKlingMediaOperation", [token, deadline.signal])) as { chat_uuid: string; message_id: string };
        if (!op.chat || ack.chat_uuid !== op.chat.chat_uuid || !SAFE_ID.test(ack.message_id)) return this.#unknown(op, "GENERATION_ACK_UNVERIFIED");
        op.ack = ack.message_id;
      } catch { return this.#unknown(op, "GENERATION_OUTCOME_UNKNOWN"); }
      op.phase = "POSTED"; return await this.#collect(op, deadline);
    } catch (error) {
      if (error instanceof OwnerKlingMediaGenerationError) throw error;
      return fail("GENERATION_OUTCOME_UNKNOWN");
    }
  }
  async #preflight(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(op, deadline, true); const read = this.#o.createReadClient(op.request.attemptId);
    if (!genuine(read, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo"])) fail("PREFLIGHT_FAILED");
    const account = await deadline.waitFor(new AccountStatusService(read, () => this.#time()).getAccountStatus(deadline.signal));
    const normalized = normalizeOwnerKlingMediaParameters(op.parameters), costParameters = Object.create(null) as Record<string, SyntxCostParameter>;
    for (const key of normalized.cost_query_keys) {
      const value = (normalized.source_parameters as Record<string, unknown>)[key];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") fail("MODEL_BINDING_MISMATCH");
      costParameters[key] = value;
    }
    const catalog = op.request.version === "1.6" ? this.#o.catalog : this.#currentCatalog ??=
      loadSelectedDiscoveryCatalog(OWNER_KLING_MEDIA_CURRENT_CONTROLS.public_catalog_version, this.#o.catalogDirectory).discoveryCatalog;
    const access = await deadline.waitFor(new ModelAccessService(catalog, read, () => this.#time()).getModelAccess({ model_id: op.request.model_id,
      cost_parameters: costParameters }, deadline.signal));
    checkAccess(access, account, op.request.model_id, normalized.cost_query_keys, this.#catalogVersion(catalog), this.#time());
    const a = (access as { observed_at: string }).observed_at, b = (account as { observed_at: string }).observed_at;
    op.quote_at = Math.min(Date.parse(a), Date.parse(b)); await this.#current(op, deadline, true);
  }
  async #current(op: Operation, deadline: AbsoluteRequestDeadline, dispatch: boolean): Promise<void> { deadline.throwIfAborted(); op.validate(dispatch);
    const p = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#o.binding, attemptId: op.request.attemptId, linkService: this.#o.linkService }));
    if (!sameGenerationPrincipal(p, op.principal)) fail("PRINCIPAL_NOT_LINKED"); deadline.throwIfAborted(); op.validate(dispatch); }
  #validateOperation(op: Operation, dispatch: boolean): void {
    if (this.#closed || op.invalid || (this.#epochs.get(op.request.attemptId) ?? 0) !== op.epoch || this.#o.resolveChatClient(op.request.attemptId) !== op.client ||
        (dispatch && (op.owned.some(row => !this.#o.referenceService.isOwnedReference(row) || row.expires_at <= this.#time())))) fail("PRINCIPAL_NOT_LINKED");
    if (op.chat && readOwnerKlingMediaChat(op.client, op.chat, op.request.attemptId)?.model_id !== op.request.model_id) fail("PRINCIPAL_NOT_LINKED");
    if (op.phase === "READY" && (this.#time() < op.quote_at || this.#time() - op.quote_at > FRESH_MS)) fail("PREFLIGHT_EXPIRED");
  }
  async #collect(op: Operation, deadline: AbsoluteRequestDeadline): Promise<OwnerKlingMediaGenerationResult> {
    try {
      await this.#current(op, deadline, false); const raw = await deadline.waitFor(callNative(op.client, "readOwnerKlingMediaHistory", [op.token, deadline.signal]));
      await this.#current(op, deadline, false); const history = historySchema.parse(raw), chatId = history.messages[0]?.chat_id;
      if (!chatId || history.pagination.total_count !== history.messages.length || history.pagination.has_next || history.pagination.has_previous ||
          history.pagination.total_pages !== (history.messages.length === 0 ? 0 : 1)) fail("HISTORY_UNVERIFIED");
      const rows = new Set<string>(), objects = new Set<string>();
      for (const row of history.messages) { if (row.chat_id !== chatId || rows.has(row.id)) fail("HISTORY_BINDING_MISMATCH"); rows.add(row.id);
        for (const item of row.message_object) { if (item.message_id !== row.id || objects.has(item.id)) fail("HISTORY_BINDING_MISMATCH"); objects.add(item.id); } }
      const media = op.wire.body.settings.file_urls as readonly Readonly<{type:string;url:string}>[];
      const owner = history.messages.filter(row => row.author_id > 0 && (!op.ack || row.id === op.ack) && row.message_object.length === media.length + 1 &&
        row.message_object.some(item => item.object_type === "text" && item.object_text === op.request.prompt) &&
        media.every(reference => row.message_object.filter(item => item.object_type === reference.type && item.object_url === reference.url).length === 1));
      if (owner.length !== 1 || history.messages.filter(row => row.author_id > 0).length !== 1 || (op.owner_echo && owner[0]!.id !== op.owner_echo)) fail("OWNER_ECHO_UNVERIFIED");
      op.owner_echo = owner[0]!.id; op.provider_chat = chatId;
      const candidates = history.messages.filter(row => row.author_id === -1 && row.message_object.some(item => item.object_type === "video"));
      const artifacts: OwnerKlingMediaArtifact[] = [];
      for (const row of candidates) {
        if (!row.message_object.length || row.message_object.some(item => item.object_type !== "video" || item.model_type !== op.request.model_id ||
            item.completed !== true || typeof item.object_url !== "string" || !isSafeUploadReferenceUrl(item.object_url))) fail("RESULT_UNVERIFIED");
        const resultContext = Object.freeze({ message_id: row.id }); RESULTS.set(resultContext, { operation: op, row });
        const detail = rowSchema.parse(await deadline.waitFor(callNative(op.client, "readOwnerKlingMediaResult", [resultContext, deadline.signal])));
        await this.#current(op, deadline, false); if (schemaHash(detail) !== schemaHash(row)) fail("RESULT_CHANGED");
        for (const item of detail.message_object) { if (artifacts.some(a => a.object_url === item.object_url)) fail("RESULT_UNVERIFIED");
          const path = new URL(item.object_url!).pathname.toLowerCase(); artifacts.push(Object.freeze({ message_object_id: item.id, object_type: "video",
            object_url: item.object_url!, mime_type: path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null,
            message_id: row.id, chat_uuid: op.chat!.chat_uuid, model_id: op.request.model_id })); }
      }
      if (!artifacts.length) return (op.result = unknown(op.request.model_id, op.recovery_id, ["RESULT_PENDING_OR_UNVERIFIED"]));
      return (op.result = Object.freeze({ ...unknown(op.request.model_id, op.recovery_id, []), status: "completed", observed_artifact_count: artifacts.length,
        artifacts: Object.freeze(artifacts) }));
    } catch { return (op.result = unknown(op.request.model_id, op.recovery_id, ["OWNED_HISTORY_OR_RESULT_UNVERIFIED"])); }
  }
  #unknown(op: Operation, gap: string): OwnerKlingMediaGenerationResult { op.phase = "POSTED"; return (op.result = unknown(op.request.model_id, op.recovery_id, [gap])); }
  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerKlingMediaGenerationError("SERVICE_CLOSED"));
    if (!ATTEMPT.test(attempt) || this.#busy.has(attempt)) return Promise.reject(new OwnerKlingMediaGenerationError("SERVICE_BUSY"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerKlingMediaGenerationError("INVALID_REQUEST"));
    const abort = new AbortController(), combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal, deadline = new AbsoluteRequestDeadline(120_000, combined,
      () => new OwnerKlingMediaGenerationError("REQUEST_ABORTED")); this.#busy.add(attempt);
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#busy.delete(attempt); this.#pending.delete(promise); });
    this.#pending.set(promise, { attempt, abort }); return promise;
  }
  #time(): number { const n = this.#o.now(); if (!Number.isSafeInteger(n) || n < this.#lastTime) fail("CLOCK_INVALID"); this.#lastTime = n; return n; }
  #catalogVersion(catalog = this.#o.catalog): string { return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`; }
  #validateClient(client: SyntxChatHttpClient): void { for (const name of ["createOwnerKlingMediaChat", "isOwnerKlingMediaChat", "invalidateOwnerKlingMediaChats",
    "startOwnerKlingMediaOperation", "readOwnerKlingMediaHistory", "readOwnerKlingMediaResult"]) if (typeof Reflect.get(client, name) !== "function") fail("NATIVE_METHOD_UNAVAILABLE"); }
}
Object.freeze(OwnerKlingMediaGenerationService.prototype);
export function isOwnerKlingMediaGenerationService(value: unknown): value is OwnerKlingMediaGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) && Object.isFrozen(value);
}
export function consumeOwnerKlingMediaDispatch(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const op = operationFor(client, token); op.validate(true); if (op.phase !== "READY" || !op.chat || op.ack) fail("INTENT_ALREADY_CLAIMED");
  op.phase = "POSTED"; return Object.freeze({ chat_uuid: op.chat.chat_uuid, body: Object.freeze({ chat_id: op.chat.chat_uuid,
    prompt: op.wire.body.prompt, settings: op.wire.body.settings }) });
}
export function readOwnerKlingMediaHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const op = operationFor(client, token); op.validate(false); if (op.phase !== "POSTED" || !op.chat) fail("OPERATION_NOT_DISPATCHED"); return op.chat.chat_uuid;
}
export function readOwnerKlingMediaResultRoute(client: SyntxChatHttpClient, context: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const row = context && typeof context === "object" && !types.isProxy(context) ? RESULTS.get(context) : undefined;
  if (!row || row.operation.client !== client || !row.operation.chat) fail("RESULT_CONTEXT_INVALID"); row.operation.validate(false);
  return Object.freeze({ chat_uuid: row.operation.chat.chat_uuid, message_id: row.row.id });
}
export function recordOwnerKlingMediaTransport(client: SyntxChatHttpClient, token: unknown, observed: unknown): void {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.client !== client || op.phase !== "POSTED") return; void observed;
}
function operationFor(client: SyntxChatHttpClient, token: unknown): Operation {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.token !== token || op.client !== client) fail("DISPATCH_CONTEXT_INVALID"); return op;
}
function callNative(client: SyntxChatHttpClient, method: string, args: unknown[]): Promise<unknown> {
  const fn = Reflect.get(client, method); if (typeof fn !== "function") return Promise.reject(new OwnerKlingMediaGenerationError("NATIVE_METHOD_UNAVAILABLE"));
  try { return Promise.resolve(Reflect.apply(fn, client, args)); } catch (e) { return Promise.reject(e); }
}
function genuine(value: unknown, ctor: Function, methods: readonly string[]): boolean {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype && methods.every(m => typeof Reflect.get(value, m) === "function"); }
  catch { return false; }
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const p = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(d);
    if ((p !== Object.prototype && p !== null) || own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) fail("INVALID_REQUEST");
    const out = Object.create(null) as Record<string, unknown>; for (const k of keys) out[k] = d[k]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); }
}
function snapshot(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const length = descriptors.length?.value as unknown;
      if (prototype !== Array.prototype || !Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > 7 ||
        Reflect.ownKeys(descriptors).length !== (length as number) + 1) fail("INVALID_REQUEST");
      const result: unknown[] = [];
      for (let i = 0; i < (length as number); i++) {
        const field = descriptors[String(i)];
        if (!field?.enumerable || !("value" in field) || typeof field.value !== "string") fail("INVALID_REQUEST");
        result.push(field.value);
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) fail("INVALID_REQUEST");
      const field: unknown = descriptors[key]!.value;
      result[key] = Array.isArray(field) ? snapshot(field) : field;
    }
    return result;
  } catch { return fail("INVALID_REQUEST"); }
}

function parameterInput(request: Request, measuredDuration?: number): OwnerKlingMediaParametersInput {
  if (request.version === "1.6") return { model_id: request.model_id, prompt: request.prompt, version: request.version, mode: request.mode,
    ...(request.model_id === "kling_o1_video2video" ? {} : { aspect_ratio: request.aspect_ratio }),
    video_duration: request.video_duration, native_audio: request.native_audio } as OwnerKlingMediaParametersInput;
  return Object.freeze({ model_id: request.model_id, prompt: request.prompt, mode: request.mode,
    video_duration: request.model_id === "kling_o1_video2video" ? measuredDuration : request.video_duration,
    ...(request.model_id === "kling_o1_video2video" ? {} : { aspect_ratio: request.aspect_ratio }),
    ...(request.model_id === "kling_elements" ? { version: request.version, native_audio: request.native_audio, multi_shots: request.multi_shots } : {}) }) as OwnerKlingMediaParametersInput;
}
function validateCurrentReferences(model: OwnerKlingMediaModelId, owned: readonly OwnerKlingMediaResolvedReference[]): void {
  const images = owned.filter(row => row.type === "image"), videos = owned.filter(row => row.type === "video");
  if (model === "kling_elements" ? videos.length !== 0 || images.length < 1 || images.length > 7 :
      model === "kling_o1_image2video" ? videos.length !== 0 || images.length < 1 || images.length > 4 : videos.length !== 1 || images.length > 4) fail("REFERENCE_UNAVAILABLE");
  for (const row of owned) {
    if (row.width < 300 || row.height < 300 || row.width > 8000 || row.height > 8000 || row.width * row.height > 64000000) fail("REFERENCE_UNAVAILABLE");
    if (row.type === "image" && (!["image/jpeg", "image/jpg", "image/png", "image/avif"].includes(row.mime_type) ||
      row.size > (model === "kling_o1_image2video" ? 30 : 10) * 1024 * 1024)) fail("REFERENCE_UNAVAILABLE");
    if (row.type === "video" && (row.duration_seconds === null || row.duration_seconds < 3 || row.duration_seconds > 10)) fail("REFERENCE_UNAVAILABLE");
  }
}

function checkAccess(access: unknown, account: unknown, model: OwnerKlingMediaModelId, keys: readonly string[], version: string, now: number): void {
  const a = record(access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live", "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "observed_at"]);
  const r = record(account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]), b = record(r.balance, ["unit", "available"]), s = record(r.subscription, ["active", "plan_type"]);
  if (a.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || a.catalog_version !== version || a.model_id !== model || a.model_type !== model || a.ai_name !== "kling" ||
      a.account_read_live !== true || a.parameters_redacted !== true || a.access !== true ||
      schemaHash(Array.isArray(a.parameter_keys) ? [...a.parameter_keys].sort() : []) !== schemaHash([...keys].sort()) || !fresh(a.observed_at, now) ||
      r.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || r.source_build !== ACCOUNT_SOURCE_BUILD || !fresh(r.observed_at, now) || b.unit !== "tokens" ||
      typeof b.available !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(b.available) || s.active !== true || typeof s.plan_type !== "string" || s.plan_type.toUpperCase() === "FREE") fail("PREFLIGHT_FAILED");
  const cost = a.discount_cost ?? a.cost; if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || !affordable(b.available, cost)) fail("BALANCE_INSUFFICIENT");
}
function fresh(value: unknown, now: number): boolean { const t = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(t) && t <= now && now - t <= FRESH_MS; }
function affordable(balance: string, cost: number): boolean { const p = String(cost); if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(p)) return false;
  const [bi, bf = ""] = balance.split("."), [ci, cf = ""] = p.split("."), n = Math.max(bf.length, cf.length); return BigInt(bi + bf.padEnd(n, "0")) >= BigInt(ci + cf.padEnd(n, "0")); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("PREFLIGHT_FAILED");
  try { const p = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value); if (p !== Object.prototype && p !== null) fail("PREFLIGHT_FAILED");
    const o = Object.create(null) as Record<string, unknown>; for (const k of keys) { const d = ds[k]; if (!d || !Object.hasOwn(d, "value") || d.enumerable !== true) fail("PREFLIGHT_FAILED"); o[k] = d.value; } return o;
  } catch { return fail("PREFLIGHT_FAILED"); } }
function unknown(model: OwnerKlingMediaModelId, recovery: string, gaps: readonly string[]): OwnerKlingMediaGenerationResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recovery, model_id: model, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function fail(code: string, recovery_id?: string): never { throw new OwnerKlingMediaGenerationError(code, recovery_id); }
