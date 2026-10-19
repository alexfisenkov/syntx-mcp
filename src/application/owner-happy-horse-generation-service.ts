import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod/v4";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { readOwnerHappyHorseChat, type OwnerHappyHorseChatContext } from "../adapter/syntx/owner-happy-horse-chat-context.js";
import { OwnerHappyHorseImageReferenceService, isOwnerHappyHorseImageReferenceService,
  type OwnerHappyHorseOwnedImage } from "./owner-happy-horse-image-reference-service.js";
import { OwnerHappyHorseEditVideoReferenceService, isOwnerHappyHorseEditVideoReferenceService,
  type OwnerHappyHorseOwnedVideo } from "./owner-happy-horse-edit-video-reference-service.js";
import { buildOwnerHappyHorseEditWire, buildOwnerHappyHorseWire, type OwnerHappyHorseWireCandidate } from "./owner-happy-horse-wire.js";
import { getOwnerHappyHorseSourceProfile, normalizeOwnerHappyHorseParameters,
  type OwnerHappyHorseModelId } from "./owner-happy-horse-parameters.js";

const MODEL_IDS = ["happy_horse_first_frame", "happy_horse_references", "happy_horse_edit"] as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY = /^happy_horse_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const PROMPT_MAX = 1_000;
const FRESH_MS = 15_000;
const MAX_OPS = 128;
const CLAIMED = new Set<string>();
const OPERATIONS = new WeakMap<object, Operation>();
const RESULTS = new WeakMap<object, { readonly op: Operation; readonly row: HistoryRow }>();
const SERVICES = new WeakSet<object>();
const GENERATE = z.object({ attemptId: z.string().regex(ATTEMPT), model_id: z.enum(MODEL_IDS), prompt: z.string().min(1).max(PROMPT_MAX),
  aspect_ratio: z.literal("16:9"), resolution: z.literal("720P"), video_duration: z.literal(5), seed: z.null(),
  reference_handle: z.string().regex(/^(?:happy_horse_image|happy_horse_video)_[0-9a-f-]{36}$/u) }).strict();
const id = z.union([z.string().regex(SAFE_ID), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const objectSchema = z.object({ id, message_id: id, object_type: z.string().max(128), object_text: z.string().max(20_000).nullable().optional(),
  object_url: z.string().max(4096).nullable().optional(), model_type: z.string().max(160).nullable().optional(), completed: z.boolean().nullable().optional() }).strip();
const rowSchema = z.object({ id, chat_id: id, author_id: z.number().int().safe(), message_object: z.array(objectSchema).max(64) }).strip();
const historySchema = z.object({ messages: z.array(rowSchema).max(10), pagination: z.object({ page: z.literal(1), page_size: z.literal(10),
  total_count: z.number().int().min(1).max(10), total_pages: z.literal(1), has_next: z.literal(false), has_previous: z.literal(false) }).strip() }).strip();
type HistoryRow = z.infer<typeof rowSchema>;
type Request = z.infer<typeof GENERATE>;

export interface OwnerHappyHorseRuntimeCatalog {
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly cost_bindings: readonly Readonly<{ model_id: OwnerHappyHorseModelId; ai_name: "happy_horse"; scope: "video";
    cost_keys: readonly ["resolution", "video_duration"] }>[];
}

/** Loads only the exact pinned public snapshot and validates both source-target model rows. */
export function loadOwnerHappyHorseRuntimeCatalog(catalogDirectory?: string): Readonly<OwnerHappyHorseRuntimeCatalog> {
  try {
    const snapshot = loadPublicCatalogVersion(getOwnerHappyHorseSourceProfile().public_catalog_version, catalogDirectory);
    const catalog = new DiscoveryCatalogRepository(snapshot), ai = snapshot.ai.find(item => item.value === "happy_horse");
    if (!ai?.active || ai.scope !== "video") return fail("MODEL_BINDING_MISMATCH");
    const costBindings = MODEL_IDS.map(modelId => {
      const model = catalog.getModel(modelId), settings = model.settings;
      const keys = settings?.get_cost_params;
      const expectedFiles = modelId === "happy_horse_first_frame" ? 1 : modelId === "happy_horse_references" ? 9 : { images: 5, videos: 1 };
      const expectedMime = modelId === "happy_horse_edit"
        ? ["video/mp4", "video/quicktime", "image/jpeg", "image/jpg", "image/png", "image/webp"]
        : ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const expectedMedia = modelId === "happy_horse_edit" ? ["videos", "images"] : ["images"];
      if (!model.active || model.id !== modelId || model.upstream_id !== modelId || model.ai_name !== "happy_horse" ||
          !settings || !Array.isArray(keys) || keys.length !== 2 || !keys.includes("resolution") || !keys.includes("video_duration") ||
          !Array.isArray(settings.accepted_file_types) || !expectedMime.every(t => settings.accepted_file_types!.includes(t)) ||
          !Array.isArray(settings.allowed_media_types) || !expectedMedia.every(t => settings.allowed_media_types!.includes(t)) ||
          schemaHash(settings.file_count_limit) !== schemaHash(expectedFiles) ||
          settings.max_file_size !== (modelId === "happy_horse_edit" ? 100 * 1024 * 1024 : 10 * 1024 * 1024) || settings.uploadable !== true ||
          (modelId !== "happy_horse_edit" && (settings.min_side !== 400 || settings.max_side !== 8_000)) ||
          (modelId === "happy_horse_edit" && (settings.min_video_duration !== 3 || settings.max_video_duration !== 60 ||
            settings.min_video_width !== 400 || settings.max_video_width !== 2_160 || settings.min_video_height !== 400 || settings.max_video_height !== 2_160 ||
            settings.min_side !== 400 || settings.max_side !== 8_000))) {
        return fail("MODEL_BINDING_MISMATCH");
      }
      return Object.freeze({ model_id: modelId, ai_name: "happy_horse" as const, scope: "video" as const,
        cost_keys: Object.freeze(["resolution", "video_duration"] as const) });
    });
    return Object.freeze({ catalog, catalog_version: getOwnerHappyHorseSourceProfile().public_catalog_version, cost_bindings: Object.freeze(costBindings) });
  } catch (error) { if (error instanceof OwnerHappyHorseGenerationError) throw error; return fail("MODEL_BINDING_MISMATCH"); }
}

export interface OwnerHappyHorseGenerationOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly referenceService: OwnerHappyHorseImageReferenceService;
  readonly editVideoReferenceService: OwnerHappyHorseEditVideoReferenceService;
  readonly catalog: DiscoveryCatalogRepository; readonly catalogDirectory?: string;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly resolveChatClient: (attemptId: string) => SyntxChatHttpClient; readonly now: () => number;
}
export interface OwnerHappyHorseArtifact {
  readonly message_object_id: string; readonly object_type: "video"; readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null; readonly message_id: string; readonly chat_uuid: string;
  readonly model_id: OwnerHappyHorseModelId;
}
export interface OwnerHappyHorseGenerationResult {
  readonly status: "completed" | "outcome_unknown"; readonly recovery_id: string; readonly model_id: OwnerHappyHorseModelId;
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"; readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false; readonly durability: "PROCESS_LOCAL_ONLY";
  readonly observed_artifact_count: number; readonly artifacts: readonly OwnerHappyHorseArtifact[]; readonly gaps: readonly string[];
}
export class OwnerHappyHorseGenerationError extends Error {
  constructor(readonly code: string) { super("The owner HappyHorse generation could not be completed safely."); this.name = "OwnerHappyHorseGenerationError"; }
}
interface Operation {
  readonly token: object; readonly request: Request; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly owned: OwnerHappyHorseOwnedImage | OwnerHappyHorseOwnedVideo; readonly wire: Readonly<OwnerHappyHorseWireCandidate>; readonly recovery: string;
  readonly semantic: string; readonly epoch: number; readonly validate: (dispatch: boolean) => void;
  chat?: OwnerHappyHorseChatContext; ack?: string; ownerEcho?: string; providerChat?: string;
  phase: "PREPARING" | "READY" | "POSTED"; quoteAt: number; invalid: boolean; responseStatus?: number; transportCode?: string;
  result: OwnerHappyHorseGenerationResult;
}

/** Owner-scoped initial-image generation. Any uncertain POST is sticky and all follow-up reads are GET-only. */
export class OwnerHappyHorseGenerationService {
  readonly #o: OwnerHappyHorseGenerationOptions; readonly #records = new Map<string, Operation>();
  readonly #busy = new Set<string>(); readonly #pending = new Map<Promise<unknown>, { attempt: string; abort: AbortController }>();
  readonly #epochs = new Map<string, number>(); #closed = false; #lastTime = 0;
  constructor(options: OwnerHappyHorseGenerationOptions) {
    if (!options || types.isProxy(options) || !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        !isOwnerHappyHorseImageReferenceService(options.referenceService) || !isOwnerHappyHorseEditVideoReferenceService(options.editVideoReferenceService) ||
        !genuine(options.catalog, DiscoveryCatalogRepository, ["getModel"]) ||
        typeof options.createReadClient !== "function" || typeof options.resolveChatClient !== "function" || typeof options.now !== "function") fail("INVALID_REQUEST");
    const pinned = loadOwnerHappyHorseRuntimeCatalog(options.catalogDirectory).catalog;
    const catalog = pinned;
    if (options.catalog.fetched_at !== catalog.fetched_at || MODEL_IDS.some(m => schemaHash(options.catalog.getModel(m)) !== schemaHash(catalog.getModel(m))) ||
        schemaHash(options.catalog.source_hashes) !== schemaHash(catalog.source_hashes)) fail("MODEL_BINDING_MISMATCH");
    this.#o = Object.freeze({ ...options, binding: Object.freeze({ ...options.binding }) }); this.#time(); SERVICES.add(this); Object.freeze(this);
  }

  generate(input: unknown, signal?: AbortSignal): Promise<OwnerHappyHorseGenerationResult> {
    let fields: Record<string, unknown>;
    try { fields = exact(input, ["attemptId", "model_id", "prompt", "aspect_ratio", "resolution", "video_duration", "seed", "reference_handle"]); }
    catch (error) { return Promise.reject(error); }
    const parsed = GENERATE.safeParse(fields); if (!parsed.success) return Promise.reject(new OwnerHappyHorseGenerationError("INVALID_REQUEST"));
    try { normalizeOwnerHappyHorseParameters({ model_id: parsed.data.model_id, prompt: parsed.data.prompt, aspect_ratio: parsed.data.aspect_ratio,
      resolution: parsed.data.resolution, video_duration: parsed.data.video_duration, seed: parsed.data.seed }); }
    catch { return Promise.reject(new OwnerHappyHorseGenerationError("INVALID_REQUEST")); }
    const request = Object.freeze(parsed.data);
    return this.#run(request.attemptId, signal, async deadline => {
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#o.binding, attemptId: request.attemptId, linkService: this.#o.linkService }));
      const parameters = { model_id: request.model_id, prompt: request.prompt, aspect_ratio: request.aspect_ratio,
        resolution: request.resolution, video_duration: request.video_duration, seed: request.seed };
      let owned: OwnerHappyHorseOwnedImage | OwnerHappyHorseOwnedVideo;
      let captured: { client: SyntxChatHttpClient; wire: Readonly<OwnerHappyHorseWireCandidate> };
      if (request.model_id === "happy_horse_edit") {
        if (!/^happy_horse_video_[0-9a-f-]{36}$/u.test(request.reference_handle)) fail("INVALID_REQUEST");
        const video = await deadline.waitFor(this.#o.editVideoReferenceService.resolveVideo({ attemptId: request.attemptId,
          reference_handle: request.reference_handle }, deadline.signal));
        if (!sameGenerationPrincipal(principal, video.principal)) fail("PRINCIPAL_NOT_LINKED");
        owned = video;
        captured = this.#o.editVideoReferenceService.withCapturedVideo(video, (client, media) => ({ client,
          wire: buildOwnerHappyHorseEditWire(parameters, { url: media.url, sha256: video.video.sha256, width: video.video.width,
            height: video.video.height, mime_type: video.video.mime_type, measured_duration_seconds: video.video.measured_duration_seconds }) }));
      } else {
        if (!/^happy_horse_image_[0-9a-f-]{36}$/u.test(request.reference_handle)) fail("INVALID_REQUEST");
        const image = await deadline.waitFor(this.#o.referenceService.resolveReference({ attemptId: request.attemptId, model_id: request.model_id,
          reference_handle: request.reference_handle }, deadline.signal));
        if (!sameGenerationPrincipal(principal, image.principal)) fail("PRINCIPAL_NOT_LINKED");
        owned = image;
        captured = this.#o.referenceService.withCapturedReference(image, (client, media) => ({ client,
          wire: buildOwnerHappyHorseWire(parameters, { url: media.url, sha256: image.image.sha256, width: image.image.width, height: image.image.height }) }));
      }
      const semantic = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, intent: captured.wire.intent_fingerprint });
      if (CLAIMED.has(semantic)) fail("INTENT_ALREADY_CLAIMED");
      if (this.#records.size >= MAX_OPS) fail("CAPACITY_EXCEEDED");
      const recovery = `happy_horse_recovery_${randomUUID()}`, token = Object.freeze({ model_id: request.model_id });
      const op: Operation = { token, request, principal, client: captured.client, owned, wire: captured.wire, recovery, semantic, epoch,
        phase: "PREPARING", quoteAt: 0, invalid: false, result: unknownResult(request.model_id, recovery, ["NOT_DISPATCHED"]),
        validate: dispatch => {
          if (this.#closed || op.invalid || (this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#o.resolveChatClient(request.attemptId) !== op.client ||
              !clientHasHappyHorseMethods(op.client)) fail("PRINCIPAL_NOT_LINKED");
          if (op.chat) { const chat = readOwnerHappyHorseChat(op.client, op.chat, request.attemptId);
            if (!chat || chat.model_id !== request.model_id || Reflect.apply(Reflect.get(op.client, "isOwnerHappyHorseChat"), op.client, [op.chat, request.attemptId]) !== true) fail("PRINCIPAL_NOT_LINKED"); }
          if (dispatch && (!(request.model_id === "happy_horse_edit" ? this.#o.editVideoReferenceService.isOwnedVideo(owned) :
            this.#o.referenceService.isOwnedReference(owned)) || owned.expires_at <= this.#time())) fail("REFERENCE_EXPIRED");
          if (dispatch && op.phase === "READY" && (this.#time() < op.quoteAt || this.#time() - op.quoteAt > FRESH_MS)) fail("PREFLIGHT_EXPIRED");
        } };
      try {
        await this.#preflight(op, deadline);
        this.#records.set(recovery, op); OPERATIONS.set(token, op);
        await this.#current(op, deadline); op.validate(true);
        try { op.chat = await deadline.waitFor(callNative(op.client, "createOwnerHappyHorseChat", [{ attemptId: request.attemptId,
          model_id: request.model_id, title: `owner-happy-horse-${randomUUID()}` }, deadline.signal])) as OwnerHappyHorseChatContext; }
        catch { CLAIMED.add(semantic); op.result = unknownResult(request.model_id, recovery, ["CHAT_CREATE_OUTCOME_UNKNOWN"]); return op.result; }
        await this.#preflight(op, deadline); await this.#current(op, deadline); op.validate(true); op.phase = "READY";
        try {
          const ack = await deadline.waitFor(callNative(op.client, "startOwnerHappyHorseOperation", [token, deadline.signal])) as { chat_uuid: string; message_id: string };
          if (!op.chat || ack.chat_uuid !== op.chat.chat_uuid || !SAFE_ID.test(ack.message_id)) fail("ACK_UNVERIFIED");
          op.ack = ack.message_id;
        } catch { CLAIMED.add(semantic); op.phase = "POSTED"; op.result = unknownResult(request.model_id, recovery, ["GENERATION_OUTCOME_UNKNOWN"]); return op.result; }
        CLAIMED.add(semantic); op.phase = "POSTED";
        return await this.#collect(op, deadline);
      } finally { /* CLAIMED is intentionally never released after dispatch becomes uncertain. */ }
    });
  }

  reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerHappyHorseGenerationResult> {
    let f: Record<string, unknown>; try { f = exact(input, ["attemptId", "recovery_id"]); } catch (e) { return Promise.reject(e); }
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.recovery_id !== "string" || !RECOVERY.test(f.recovery_id)) return Promise.reject(new OwnerHappyHorseGenerationError("INVALID_REQUEST"));
    return this.#run(f.attemptId, signal, async deadline => { const op = this.#records.get(f.recovery_id as string);
      if (!op || op.request.attemptId !== f.attemptId) fail("RECOVERY_NOT_FOUND"); await this.#current(op, deadline); op.validate(false);
      if (op.phase !== "POSTED" || op.result.status === "completed") return op.result; return this.#collect(op, deadline); });
  }
  listRecoveries(input: unknown, signal?: AbortSignal): Promise<readonly OwnerHappyHorseGenerationResult[]> {
    let f: Record<string, unknown>; try { f = exact(input, ["attemptId"]); } catch (e) { return Promise.reject(e); }
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) return Promise.reject(new OwnerHappyHorseGenerationError("INVALID_REQUEST"));
    return this.#run(f.attemptId, signal, async deadline => { const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#o.binding,
      attemptId: f.attemptId as string, linkService: this.#o.linkService }));
      return Object.freeze([...this.#records.values()].filter(op => !op.invalid && op.request.attemptId === f.attemptId && sameGenerationPrincipal(op.principal, principal)).map(op => op.result)); });
  }
  async invalidateAttempt(attempt: string): Promise<void> { if (!ATTEMPT.test(attempt)) return; this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const op of this.#records.values()) if (op.request.attemptId === attempt) { op.invalid = true; try { callNative(op.client, "invalidateOwnerHappyHorseChats", [attempt]); } catch {} }
    const pending = [...this.#pending].filter(([, row]) => row.attempt === attempt); for (const [, row] of pending) row.abort.abort(); await Promise.allSettled(pending.map(([p]) => p));
    for (const [id, op] of this.#records) if (op.request.attemptId === attempt) this.#records.delete(id);
    await Promise.all([this.#o.referenceService.invalidateAttempt(attempt), this.#o.editVideoReferenceService.invalidateAttempt(attempt)]);
  }
  async close(): Promise<void> { this.#closed = true; for (const row of this.#pending.values()) row.abort.abort();
    for (const op of this.#records.values()) { op.invalid = true; try { callNative(op.client, "invalidateOwnerHappyHorseChats", [op.request.attemptId]); } catch {} }
    await Promise.allSettled([...this.#pending.keys()]); this.#records.clear();
    await Promise.all([this.#o.referenceService.close(), this.#o.editVideoReferenceService.close()]); }

  async #preflight(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> {
    await this.#current(op, deadline); op.validate(true);
    const read = this.#o.createReadClient(op.request.attemptId);
    if (!genuine(read, SyntxHttpClient, ["getAccountBalance", "getSubscription", "getModelInfo"])) fail("PREFLIGHT_FAILED");
    const account = await deadline.waitFor(new AccountStatusService(read, () => this.#time()).getAccountStatus(deadline.signal));
    const cost = Object.freeze({ resolution: op.request.resolution, video_duration: op.request.video_duration });
    const access = await deadline.waitFor(new ModelAccessService(this.#o.catalog, read, () => this.#time()).getModelAccess({ model_id: op.request.model_id,
      cost_parameters: { ...cost } }, deadline.signal));
    checkAccess(access, account, op.request.model_id, cost, this.#catalogVersion(), this.#time());
    op.quoteAt = Math.min(Date.parse((account as { observed_at: string }).observed_at), Date.parse((access as { observed_at: string }).observed_at));
    await this.#current(op, deadline); op.validate(true);
  }
  async #current(op: Operation, deadline: AbsoluteRequestDeadline): Promise<void> { deadline.throwIfAborted(); op.validate(false);
    const principal = await deadline.waitFor(resolveOwnerReferencePrincipal({ binding: this.#o.binding, attemptId: op.request.attemptId, linkService: this.#o.linkService }));
    if (!sameGenerationPrincipal(principal, op.principal)) fail("PRINCIPAL_NOT_LINKED"); deadline.throwIfAborted(); op.validate(false); }
  async #collect(op: Operation, deadline: AbsoluteRequestDeadline): Promise<OwnerHappyHorseGenerationResult> {
    try {
      await this.#current(op, deadline);
      const raw = await deadline.waitFor(callNative(op.client, "readOwnerHappyHorseHistory", [op.token, deadline.signal])); await this.#current(op, deadline);
      const h = historySchema.parse(raw); if (h.pagination.total_count !== h.messages.length) fail("HISTORY_INCOMPLETE");
      const providerChat = h.messages[0]!.chat_id, media = op.wire.wire.settings.file_urls[0]!;
      const mediaType = op.request.model_id === "happy_horse_edit" ? "video" : "image";
      const seenMessages = new Set<string>(), seenObjects = new Set<string>();
      for (const row of h.messages) {
        if (row.chat_id !== providerChat || seenMessages.has(row.id)) fail("HISTORY_BINDING_MISMATCH");
        seenMessages.add(row.id);
        for (const object of row.message_object) {
          if (object.message_id !== row.id || seenObjects.has(object.id)) fail("HISTORY_BINDING_MISMATCH");
          seenObjects.add(object.id);
        }
      }
      const owner = h.messages.filter(row => row.author_id > 0 && (!op.ack || row.id === op.ack) && row.message_object.length === 2 &&
        row.message_object.some(obj => obj.object_type === "text" && obj.object_text === op.request.prompt) &&
        row.message_object.some(obj => obj.object_type === mediaType && obj.object_url === media.url));
      if (owner.length !== 1 || h.messages.filter(row => row.author_id > 0).length !== 1 || (op.ownerEcho && owner[0]!.id !== op.ownerEcho)) fail("OWNER_ECHO_UNVERIFIED");
      op.ownerEcho = owner[0]!.id; op.providerChat = providerChat;
      const candidates = h.messages.filter(row => row.author_id === -1 && row.message_object.some(obj => obj.object_type === "video"));
      const artifacts: OwnerHappyHorseArtifact[] = [];
      for (const row of candidates) {
        if (!row.message_object.length || row.message_object.some(obj => obj.object_type !== "video" || obj.model_type !== op.request.model_id ||
            obj.completed !== true || typeof obj.object_url !== "string" || !isSafeUploadReferenceUrl(obj.object_url))) fail("RESULT_UNVERIFIED");
        const ctx = Object.freeze({ model_id: op.request.model_id }); RESULTS.set(ctx, { op, row }); await this.#current(op, deadline);
        const result = rowSchema.parse(await deadline.waitFor(callNative(op.client, "readOwnerHappyHorseResult", [ctx, deadline.signal]))); await this.#current(op, deadline);
        if (schemaHash(result) !== schemaHash(row)) fail("RESULT_CHANGED");
        for (const obj of result.message_object) { if (artifacts.some(a => a.object_url === obj.object_url)) fail("RESULT_UNVERIFIED");
          const path = new URL(obj.object_url!).pathname.toLowerCase(); artifacts.push(Object.freeze({ message_object_id: obj.id, object_type: "video",
            object_url: obj.object_url!, mime_type: path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".mov") ? "video/quicktime" : null,
            message_id: row.id, chat_uuid: op.chat!.chat_uuid, model_id: op.request.model_id })); }
      }
      if (!artifacts.length) { op.result = unknownResult(op.request.model_id, op.recovery, ["RESULT_PENDING_OR_UNVERIFIED"]); return op.result; }
      op.result = Object.freeze({ ...unknownResult(op.request.model_id, op.recovery, []), status: "completed", observed_artifact_count: artifacts.length,
        artifacts: Object.freeze(artifacts) }); return op.result;
    } catch { op.result = unknownResult(op.request.model_id, op.recovery, ["OWNED_HISTORY_OR_RESULT_UNVERIFIED"]); return op.result; }
  }
  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerHappyHorseGenerationError("SERVICE_CLOSED"));
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) return Promise.reject(new OwnerHappyHorseGenerationError("INVALID_REQUEST"));
    if (this.#busy.has(attempt) || this.#pending.size >= 4) return Promise.reject(new OwnerHappyHorseGenerationError("SERVICE_BUSY"));
    const abort = new AbortController(), combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const deadline = new AbsoluteRequestDeadline(120_000, combined, () => new OwnerHappyHorseGenerationError("REQUEST_ABORTED")); this.#busy.add(attempt);
    const promise = Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#busy.delete(attempt); this.#pending.delete(promise); });
    this.#pending.set(promise, { attempt, abort }); return promise;
  }
  #time(): number { let n: unknown; try { n = this.#o?.now?.() ?? Date.now(); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(n) || (n as number) < this.#lastTime) fail("CLOCK_INVALID"); this.#lastTime = n as number; return n as number; }
  #catalogVersion(): string { return `${this.#o.catalog.fetched_at}.${this.#o.catalog.source_hashes.models.slice(7, 19)}`; }
}
Object.freeze(OwnerHappyHorseGenerationService.prototype);

export function isOwnerHappyHorseGenerationService(value: unknown): value is OwnerHappyHorseGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) && Object.isFrozen(value);
}
export function consumeOwnerHappyHorseDispatch(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; body: Record<string, unknown> }> {
  const op = operationFor(client, token); op.validate(true); if (op.phase !== "READY" || !op.chat || CLAIMED.has(op.semantic)) fail("INTENT_ALREADY_CLAIMED");
  CLAIMED.add(op.semantic); op.phase = "POSTED";
  return Object.freeze({ chat_uuid: op.chat.chat_uuid, body: Object.freeze({ chat_id: op.chat.chat_uuid, prompt: op.wire.wire.prompt, settings: op.wire.wire.settings }) });
}
export function readOwnerHappyHorseHistoryRoute(client: SyntxChatHttpClient, token: unknown): string {
  const op = operationFor(client, token); op.validate(false); if (op.phase !== "POSTED" || !op.chat) fail("OPERATION_NOT_DISPATCHED"); return op.chat.chat_uuid;
}
export function readOwnerHappyHorseResultRoute(client: SyntxChatHttpClient, token: unknown): Readonly<{ chat_uuid: string; message_id: string }> {
  const state = token && typeof token === "object" && !types.isProxy(token) ? RESULTS.get(token) : undefined;
  if (!state || state.op.client !== client) fail("RESULT_CONTEXT_INVALID"); state.op.validate(false);
  if (state.op.phase !== "POSTED" || !state.op.chat) fail("RESULT_CONTEXT_INVALID"); return Object.freeze({ chat_uuid: state.op.chat.chat_uuid, message_id: state.row.id });
}
export function recordOwnerHappyHorseTransport(client: SyntxChatHttpClient, token: unknown, observed: unknown): void {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.client !== client || op.phase !== "POSTED") return;
  if (typeof observed === "number" && Number.isInteger(observed) && observed >= 100 && observed <= 599 && op.responseStatus === undefined) op.responseStatus = observed;
  if (typeof observed === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(observed) && op.transportCode === undefined) op.transportCode = observed;
}

function operationFor(client: SyntxChatHttpClient, token: unknown): Operation {
  const op = token && typeof token === "object" && !types.isProxy(token) ? OPERATIONS.get(token) : undefined;
  if (!op || op.token !== token || op.client !== client) fail("DISPATCH_CONTEXT_INVALID"); return op;
}
function clientHasHappyHorseMethods(client: SyntxChatHttpClient): boolean {
  return ["createOwnerHappyHorseChat", "isOwnerHappyHorseChat", "startOwnerHappyHorseOperation", "readOwnerHappyHorseHistory", "readOwnerHappyHorseResult", "invalidateOwnerHappyHorseChats"]
    .every(name => typeof Reflect.get(client, name) === "function");
}
function callNative(client: SyntxChatHttpClient, method: string, args: unknown[]): Promise<unknown> {
  const fn = Reflect.get(client, method); if (typeof fn !== "function") return Promise.reject(new OwnerHappyHorseGenerationError("NATIVE_METHOD_UNAVAILABLE"));
  try { return Promise.resolve(Reflect.apply(fn, client, args)); } catch (error) { return Promise.reject(error); }
}
function genuine(value: unknown, ctor: Function, methods: readonly string[]): boolean {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ctor.prototype &&
    methods.every(method => typeof Reflect.get(value, method) === "function"); } catch { return false; }
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const p = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(d);
    if ((p !== Object.prototype && p !== null) || own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) fail("INVALID_REQUEST");
    const out = Object.create(null) as Record<string, unknown>; for (const key of keys) out[key] = d[key]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); }
}
function checkAccess(access: unknown, account: unknown, model: OwnerHappyHorseModelId, cost: Readonly<{ resolution: "720P"; video_duration: 5 }>, version: string, now: number): void {
  const a = record(access, ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live", "parameter_keys",
    "parameters_redacted", "access", "cost", "discount_cost", "observed_at"]);
  const row = record(account, ["balance", "subscription", "contract_evidence", "source_build", "observed_at"]);
  const balance = record(row.balance, ["unit", "available"]), subscription = record(row.subscription, ["active", "plan_type"]);
  const keys = Array.isArray(a.parameter_keys) ? a.parameter_keys : [];
  if (a.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || a.catalog_version !== version || a.model_id !== model || a.model_type !== model ||
      a.ai_name !== "happy_horse" || a.account_read_live !== true || a.parameters_redacted !== true || a.access !== true ||
      keys.length !== 2 || !keys.includes("resolution") || !keys.includes("video_duration") || !fresh(a.observed_at, now) ||
      row.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || row.source_build !== ACCOUNT_SOURCE_BUILD || !fresh(row.observed_at, now) ||
      balance.unit !== "tokens" || typeof balance.available !== "string" || balance.available.length > 128 ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(balance.available) || subscription.active !== true || typeof subscription.plan_type !== "string" ||
      subscription.plan_type.toUpperCase() === "FREE") fail("PREFLIGHT_FAILED");
  const price = a.discount_cost ?? a.cost; if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || !isDecimalAffordable(balance.available as string, price)) fail("BALANCE_INSUFFICIENT");
  void cost;
}
function fresh(value: unknown, now: number): value is string { const t = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(t) && t <= now && now - t <= FRESH_MS; }
function isDecimalAffordable(balance: string, price: number): boolean { const p = String(price); if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(p)) return false;
  const [bi, bf = ""] = balance.split("."), [pi, pf = ""] = p.split("."), digits = Math.max(bf.length, pf.length);
  const b = BigInt(bi + bf.padEnd(digits, "0")), cost = BigInt(pi + pf.padEnd(digits, "0")); return b >= cost; }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("PREFLIGHT_FAILED");
  try { const p = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value);
    if (p !== Object.prototype && p !== null) fail("PREFLIGHT_FAILED");
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of keys) { const d = ds[key]; if (!d || !Object.hasOwn(d, "value") || d.enumerable !== true) fail("PREFLIGHT_FAILED"); out[key] = d.value; }
    return out;
  } catch { return fail("PREFLIGHT_FAILED"); }
}
function unknownResult(model: OwnerHappyHorseModelId, recovery: string, gaps: readonly string[]): OwnerHappyHorseGenerationResult {
  return Object.freeze({ status: "outcome_unknown", recovery_id: recovery, model_id: model, status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
function fail(code: string): never { throw new OwnerHappyHorseGenerationError(code); }
