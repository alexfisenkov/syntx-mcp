import type { AuthBinding } from "../auth/types.js";
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { validateOwnerCurrentVideoPromptAliases } from "./owner-current-video-reference-prompt.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxHttpClient as ReadClient, isSyntxModelInfoCallerParameterKey } from "../adapter/syntx/http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService } from "./account-status.js";
import { ModelAccessService } from "./model-access.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { getOwnerFlux3CurrentFamilyDefinition } from "./owner-flux3-current-intent.js";
import { getOwnerWanCurrentFamilyDefinition } from "./owner-wan-current-intent.js";
import { getOwnerSeedanceCurrentFamilyDefinition } from "./owner-seedance-current-intent.js";
import { getOwnerHailuo3CurrentFamilyDefinition } from "./owner-hailuo3-current-intent.js";
import { getOwnerLumaCurrentFamilyDefinition } from "./owner-luma-current-intent.js";
import { getOwnerVeo3CurrentFamilyDefinition } from "./owner-veo3-current-intent.js";
import { getOwnerVeoOmni12CurrentFamilyDefinition } from "./owner-veo-omni12-current-intent.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerCurrentVideoNativePort, OwnerCurrentVideoReferenceMetadata, OwnerCurrentVideoReferenceModelId,
  OwnerCurrentVideoReferencePort, OwnerCurrentVideoReferenceRole, OwnerCurrentVideoNativeOperation } from "./owner-current-video-reference-types.js";

export interface OwnerCurrentVideoSourcePins {
  readonly public_catalog_version: string;
  readonly settings_inventory_version: string;
  readonly form_id: string;
  readonly form_sha256: string;
}
export interface OwnerCurrentVideoIntentDescription {
  readonly model_id: OwnerCurrentVideoReferenceModelId;
  readonly mode: string;
  readonly ai_name: string;
  readonly prompt: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly cost_parameters: Readonly<Record<string, string | number | boolean>>;
  readonly reference_metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[];
  readonly reference_prompt_mode: "DISABLED_LITERAL" | "ENABLED_ALIASES";
  readonly intent_fingerprint: string;
  readonly source_profile_sha256: string;
  readonly source_pins: Readonly<OwnerCurrentVideoSourcePins>;
}
export interface OwnerCurrentVideoNormalizedFamilyInput {
  readonly model_id: OwnerCurrentVideoReferenceModelId;
  readonly mode: string;
}
export interface OwnerCurrentVideoFamilyDefinition<N extends OwnerCurrentVideoNormalizedFamilyInput, I extends object> {
  readonly model_ids: readonly OwnerCurrentVideoReferenceModelId[];
  readonly source_profile_sha256: string;
  readonly source_pins: Readonly<OwnerCurrentVideoSourcePins>;
  normalize(input: unknown, referenceCount: number): N;
  compile(input: N, metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): I;
  inspect(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null;
}
export interface OwnerCurrentVideoGenerationServiceOptions<N extends OwnerCurrentVideoNormalizedFamilyInput, I extends object> {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly references: OwnerCurrentVideoReferencePort;
  readonly native: OwnerCurrentVideoNativePort<I>;
  readonly family: OwnerCurrentVideoFamilyDefinition<N, I>;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly now?: () => number;
  readonly catalogDirectory?: string;
  readonly timeoutMs?: number;
}
export interface OwnerCurrentVideoGenerateInput {
  readonly attemptId: string;
  readonly input: unknown;
  readonly references: readonly Readonly<{ reference_handle: string; role: OwnerCurrentVideoReferenceRole }>[];
}

const CATALOG = "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json";
const SETTINGS = "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json";
const MODELS_HASH = "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438";
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, HANDLE = /^current_video_ref_[0-9a-f-]{36}$/u;
const RECOVERY = /^current_video_recovery_[0-9a-f-]{36}$/u, SHA = /^sha256:[a-f0-9]{64}$/u;
const CLAIMS = new Set<string>(), MAX_CLAIMS = 8192, MAX_RECORDS = 128, MAX_ACTIVE = 4;
const definitions = Object.freeze([getOwnerFlux3CurrentFamilyDefinition(), getOwnerWanCurrentFamilyDefinition(), getOwnerSeedanceCurrentFamilyDefinition(), getOwnerHailuo3CurrentFamilyDefinition(), getOwnerLumaCurrentFamilyDefinition(), getOwnerVeo3CurrentFamilyDefinition(), getOwnerVeoOmni12CurrentFamilyDefinition()]);

/** Closed static authority only. Descriptors cannot be registered by a caller or recovered from a JSON copy. */
export function inspectOwnerCurrentVideoIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null {
  for (const definition of definitions) {
    const description = definition.inspect(value);
    if (description && (definition.model_ids as readonly string[]).includes(description.model_id)) return description;
  }
  return null;
}
export type OwnerCurrentVideoGenerationErrorCode = "INVALID_REQUEST" | "SOURCE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "MODEL_ACCESS_DENIED" |
  "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "INTENT_ALREADY_CLAIMED" | "RECOVERY_NOT_FOUND" | "SERVICE_CLOSED" | "OPERATION_UNVERIFIED" | "OUTCOME_UNKNOWN";
export class OwnerCurrentVideoGenerationError extends Error {
  constructor(readonly code: OwnerCurrentVideoGenerationErrorCode, readonly recovery_id?: string) {
    super(code === "OUTCOME_UNKNOWN" ? "The operation outcome is unknown; do not repeat it. Use read-only recovery."
      : "The source-reviewed current video operation could not be completed safely."); this.name = "OwnerCurrentVideoGenerationError";
  }
}
export class OwnerCurrentVideoUnknownOutcomeError extends OwnerCurrentVideoGenerationError {
  constructor(recoveryId: string) { super("OUTCOME_UNKNOWN", recoveryId); this.name = "OwnerCurrentVideoUnknownOutcomeError"; }
}
export interface OwnerCurrentVideoGenerationResult {
  readonly status: "pending" | "completed" | "unverified" | "outcome_unknown";
  readonly recovery_id: string;
  readonly model_id: OwnerCurrentVideoReferenceModelId;
  readonly source_binding: Readonly<{ profile_sha256: string; source_pins: Readonly<OwnerCurrentVideoSourcePins>; intent_fingerprint: string }>;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly artifacts: readonly Readonly<{ url: string; mime_type: string | null; message_id: string; message_object_id: string }>[];
  readonly phase: "CHAT_CREATE_INVOKED" | "CHAT_CREATED" | "DISPATCH_INVOKED" | "ACKNOWLEDGED" | "OBSERVED";
  readonly backend_acceptance: "UNPROVEN";
  readonly cost_cap_enforced: false;
  readonly durability: "PROCESS_LOCAL_ONLY";
  readonly diagnostic?: import("./owner-current-video-reference-types.js").OwnerCurrentVideoDispatchDiagnostic;
}
interface RecoveryEntry {
  readonly id: string; readonly attempt: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly description: Readonly<OwnerCurrentVideoIntentDescription>; operation?: OwnerCurrentVideoNativeOperation;
  result: OwnerCurrentVideoGenerationResult;
}
interface ActiveRun { readonly attempt: string; readonly controller: AbortController; readonly promise: Promise<unknown>; }

/** One shared app orchestration for closed current families. Runtime owns the shared ports' close/invalidation order. */
export class OwnerCurrentVideoGenerationService<N extends OwnerCurrentVideoNormalizedFamilyInput, I extends object> {
  readonly #options: OwnerCurrentVideoGenerationServiceOptions<N, I>;
  readonly #catalog: ReturnType<typeof loadSelectedDiscoveryCatalog>["discoveryCatalog"];
  readonly #records = new Map<string, RecoveryEntry>(); readonly #active = new Set<ActiveRun>(); readonly #busy = new Set<string>();
  readonly #invalidating = new Set<string>(); readonly #now: () => number; readonly #timeout: number;
  #closed = false; #closing: Promise<void> | undefined; #lastNow = -1;
  constructor(options: OwnerCurrentVideoGenerationServiceOptions<N, I>) {
    plain(options); plain(options.binding);
    if (!definitions.some(definition => (definition as object) === (options.family as object)) || !Object.isFrozen(options.family) ||
        typeof options.binding.tenant_id !== "string" || !options.binding.tenant_id || typeof options.binding.subject !== "string" || !options.binding.subject ||
        typeof options.createReadClient !== "function" || types.isProxy(options.createReadClient)) fail("SOURCE_BINDING_MISMATCH");
    for (const [port, methods] of [[options.references, ["prepare", "revalidate"]], [options.native, ["createChat", "dispatch", "observe"]]] as const) {
      if (!port || typeof port !== "object" || types.isProxy(port) || methods.some(method => typeof dataMethod(port, method) !== "function")) fail("SOURCE_BINDING_MISMATCH");
    }
    const pins = options.family.source_pins;
    const catalogVersion = options.family === (getOwnerVeoOmni12CurrentFamilyDefinition() as unknown) ? pins.public_catalog_version : CATALOG;
    const settingsVersion = options.family === (getOwnerVeoOmni12CurrentFamilyDefinition() as unknown) ? pins.settings_inventory_version : SETTINGS;
    const modelsHash = options.family === (getOwnerVeoOmni12CurrentFamilyDefinition() as unknown)
      ? "sha256:24bbc57596f4d3aa33e72f8bd8004f72ff1eb769e33675a71eedc75a586d9252" : MODELS_HASH;
    this.#catalog = loadSelectedDiscoveryCatalog(catalogVersion, options.catalogDirectory).discoveryCatalog;
    const inventory = loadMaplessSettingsInventoryVersion(settingsVersion, options.catalogDirectory);
    const form = inventory.forms.find(row => row.form_id === pins.form_id);
    if (this.#catalog.source_hashes.models !== modelsHash || pins.public_catalog_version !== catalogVersion || pins.settings_inventory_version !== settingsVersion ||
        inventory.public_catalog.version !== catalogVersion || inventory.public_catalog.models_sha256 !== modelsHash || !form || form.javascript.sha256 !== pins.form_sha256 ||
        !SHA.test(options.family.source_profile_sha256) || options.family.model_ids.some(model => !this.#catalog.getModel(model).active ||
          inventory.models.find(row => row.model_id === model)?.form_id !== pins.form_id)) fail("SOURCE_BINDING_MISMATCH");
    this.#options = Object.freeze({ ...options, binding: Object.freeze({ ...options.binding }) });
    this.#now = options.now ?? Date.now;
    this.#timeout = options.timeoutMs ?? 15 * 60000;
    if (typeof this.#now !== "function" || types.isProxy(this.#now) || !Number.isSafeInteger(this.#timeout) || this.#timeout < 1000 || this.#timeout > 15 * 60000) fail("INVALID_REQUEST");
    this.#time(); Object.freeze(this);
  }
  generate(value: OwnerCurrentVideoGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerCurrentVideoGenerationResult> {
    const row = exact(value, ["attemptId", "input", "references"]), attempt = attemptId(row.attemptId), references = referenceSelection(row.references);
    let normalized: N;
    try { normalized = this.#options.family.normalize(row.input, references.length); }
    catch (error) { if (error instanceof OwnerCurrentVideoGenerationError) throw error; return fail("INVALID_REQUEST"); }
    if (!(this.#options.family.model_ids as readonly string[]).includes(normalized.model_id)) fail("SOURCE_BINDING_MISMATCH");
    return this.#run(attempt, signal, async deadline => {
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const principal = await this.#principal(attempt), selected = await deadline.waitFor(this.#options.references.prepare({ attemptId: attempt,
        model_id: normalized.model_id, mode: normalized.mode, references }, deadline.signal));
      let intent: I;
      try { intent = this.#options.family.compile(normalized, selected.metadata); }
      catch (error) { if (error instanceof OwnerCurrentVideoGenerationError) throw error; return fail("INVALID_REQUEST"); }
      const description = this.#options.family.inspect(intent);
      if (!description || inspectOwnerCurrentVideoIntent(intent) !== description || description.model_id !== normalized.model_id || description.mode !== normalized.mode ||
          description.settings.model_type !== normalized.model_id || Object.hasOwn(description.settings, "file_urls") ||
          description.source_profile_sha256 !== this.#options.family.source_profile_sha256 || !SHA.test(description.intent_fingerprint) ||
          schemaHash(description.source_pins) !== schemaHash(this.#options.family.source_pins) || schemaHash(description.reference_metadata) !== schemaHash(selected.metadata) ||
          this.#catalog.getModel(description.model_id).ai_name !== description.ai_name) fail("SOURCE_BINDING_MISMATCH");
      try { validateOwnerCurrentVideoPromptAliases(description.prompt, description.model_id, description.reference_prompt_mode, selected.metadata); }
      catch { fail("INVALID_REQUEST"); }
      const semantic = schemaHash({ tenant: principal.tenant_id, subject: principal.subject_id, model: description.model_id, source: description.source_profile_sha256,
        mode: description.mode, prompt: description.prompt, settings: description.settings, references: description.reference_metadata });
      if (CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED"); if (this.#busy.has(semantic)) fail("SERVICE_BUSY");
      if (CLAIMS.size >= MAX_CLAIMS) fail("CAPACITY_EXCEEDED"); this.#busy.add(semantic);
      let recovery: RecoveryEntry | undefined;
      try {
        await this.#preflight(attempt, principal, description, deadline);
        await deadline.waitFor(this.#options.references.revalidate(selected.bundle, deadline.signal)); deadline.throwIfAborted();
        if (CLAIMS.has(semantic)) fail("INTENT_ALREADY_CLAIMED"); CLAIMS.add(semantic);
        const id = `current_video_recovery_${randomUUID()}`;
        recovery = { id, attempt, principal, description, result: result(id, description, "outcome_unknown", "CHAT_CREATE_INVOKED", []) };
        this.#records.set(id, recovery);
        recovery.operation = await deadline.waitFor(this.#options.native.createChat({ attemptId: attempt, bundle: selected.bundle, intent }, deadline.signal));
        recovery.result = result(id, description, "outcome_unknown", "CHAT_CREATED", []);
        await this.#preflight(attempt, principal, description, deadline);
        // Nothing asynchronous may be inserted between final revalidation and the native one-shot dispatch seam.
        await deadline.waitFor(this.#options.references.revalidate(selected.bundle, deadline.signal)); deadline.throwIfAborted();
        recovery.result = result(id, description, "outcome_unknown", "DISPATCH_INVOKED", []);
        const ack = await deadline.waitFor(this.#options.native.dispatch(recovery.operation, deadline.signal));
        if (ack.status !== "acknowledged") throw new OwnerCurrentVideoUnknownOutcomeError(id);
        recovery.result = result(id, description, "pending", "ACKNOWLEDGED", []);
        return await this.#observe(recovery, deadline);
      } catch (error) {
        if (recovery) throw new OwnerCurrentVideoUnknownOutcomeError(recovery.id);
        if (error instanceof OwnerCurrentVideoGenerationError) throw error;
        return fail("OPERATION_UNVERIFIED");
      } finally { this.#busy.delete(semantic); }
    });
  }
  reconcile(value: unknown, signal?: AbortSignal): Promise<OwnerCurrentVideoGenerationResult> {
    const row = exact(value, ["attemptId", "recovery_id"]), attempt = attemptId(row.attemptId);
    if (typeof row.recovery_id !== "string" || !RECOVERY.test(row.recovery_id)) fail("INVALID_REQUEST");
    return this.#run(attempt, signal, async deadline => {
      const entry = this.#records.get(row.recovery_id as string), principal = await this.#principal(attempt);
      if (!entry || entry.attempt !== attempt || !sameGenerationPrincipal(entry.principal, principal)) fail("RECOVERY_NOT_FOUND");
      if (entry.result.status === "completed" || !entry.operation) return entry.result;
      // Owned result reads deliberately do not revalidate expired input handles, quote, upload, create, or dispatch.
      return await this.#observe(entry, deadline);
    });
  }
  listRecoveries(value: unknown): readonly OwnerCurrentVideoGenerationResult[] {
    this.#assertOpen(); const row = exact(value, ["attemptId"], ["limit"]), attempt = attemptId(row.attemptId), limit = row.limit ?? 128;
    if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 128) fail("INVALID_REQUEST");
    return Object.freeze([...this.#records.values()].filter(entry => entry.attempt === attempt).slice(0, limit as number).map(entry => entry.result));
  }
  async invalidateAttempt(value: string): Promise<void> {
    const attempt = attemptId(value); this.#invalidating.add(attempt);
    const active = [...this.#active].filter(run => run.attempt === attempt); for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map(run => run.promise)); for (const [id, entry] of this.#records) if (entry.attempt === attempt) this.#records.delete(id);
    this.#invalidating.delete(attempt); // Semantic tombstones intentionally survive unlink/relink in this process.
  }
  close(): Promise<void> { if (this.#closing) return this.#closing; this.#closed = true; for (const run of this.#active) run.controller.abort();
    return this.#closing = Promise.allSettled([...this.#active].map(run => run.promise)).then(() => { this.#records.clear(); }); }
  async #preflight(attempt: string, expected: Readonly<GenerationPrincipalRef>, description: Readonly<OwnerCurrentVideoIntentDescription>, deadline: AbsoluteRequestDeadline) {
    await this.#current(attempt, expected); deadline.throwIfAborted();
    const model = this.#catalog.getModel(description.model_id), keys = Object.keys(description.cost_parameters).sort();
    // Flux source leaves draft undefined; its pinned Axios serializer omits that query field.
    const fluxOmittedDraft = this.#options.family === (getOwnerFlux3CurrentFamilyDefinition() as unknown) && !Object.hasOwn(description.cost_parameters, "draft");
    const omni12 = this.#options.family === (getOwnerVeoOmni12CurrentFamilyDefinition() as unknown);
    const omni12FirstClip = omni12 && description.mode === "image" && description.reference_metadata.length === 1 &&
      description.reference_metadata[0]?.role === "first_clip";
    const omni12ReferenceVideo = omni12 && description.mode === "references" &&
      description.reference_metadata.some(reference => reference.kind === "video");
    if (omni12 && (Object.hasOwn(description.cost_parameters, "veo3_type") !== omni12FirstClip ||
        (omni12FirstClip && description.cost_parameters.veo3_type !== "extend") ||
        Object.hasOwn(description.cost_parameters, "mode") !== omni12ReferenceVideo ||
        (omni12ReferenceVideo && description.cost_parameters.mode !== "full"))) fail("SOURCE_BINDING_MISMATCH");
    const allowed = (model.settings?.get_cost_params ?? []).filter(isSyntxModelInfoCallerParameterKey)
      .filter(key => !(fluxOmittedDraft && key === "draft") && !(omni12 && key === "mode" && !Object.hasOwn(description.cost_parameters, "mode"))).sort();
    if (omni12FirstClip) allowed.push("veo3_type");
    allowed.sort();
    if (keys.join("\0") !== allowed.join("\0")) fail("SOURCE_BINDING_MISMATCH");
    const client = this.#options.createReadClient(attempt);
    if (!client || types.isProxy(client) || Object.getPrototypeOf(client) !== ReadClient.prototype ||
        ["getAccountBalance", "getSubscription", "getModelInfo"].some(method => Object.hasOwn(client, method) || dataMethod(client, method) !== dataMethod(ReadClient.prototype, method))) fail("SOURCE_BINDING_MISMATCH");
    const account = await deadline.waitFor(new AccountStatusService(client, () => this.#time()).getAccountStatus(deadline.signal));
    const access = await deadline.waitFor(new ModelAccessService(this.#catalog, client, () => this.#time(),
      omni12FirstClip ? { model_id: "omni1.2", extraCostParameterKeys: { veo3_type: "extend" } } : undefined).getModelAccess({ model_id: description.model_id,
      cost_parameters: description.cost_parameters }, deadline.signal));
    const now = this.#time(), price = access.discount_cost ?? access.cost, expiry = account.subscription.end_date;
    const expires = expiry === null ? null : Date.parse(account.subscription.end_date_kind === "DATE_ONLY" ? `${expiry}T23:59:59.999Z` : expiry);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || account.balance.unit !== "tokens" ||
        typeof account.balance.available !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(account.balance.available) || !account.subscription.active ||
        expires !== null && (!Number.isFinite(expires) || expires < now) || !fresh(account.observed_at, now) || !fresh(access.observed_at, now) ||
        access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}` ||
        !access.account_read_live || !access.access || !access.parameters_redacted || access.model_id !== description.model_id || access.model_type !== model.upstream_id ||
        access.ai_name !== description.ai_name || [...access.parameter_keys].sort().join("\0") !== keys.join("\0") || typeof price !== "number" || !Number.isFinite(price) || price < 0 ||
        !decimalLte(String(price), account.balance.available)) fail("MODEL_ACCESS_DENIED");
    await this.#current(attempt, expected); deadline.throwIfAborted();
  }
  async #observe(entry: RecoveryEntry, deadline: AbsoluteRequestDeadline): Promise<OwnerCurrentVideoGenerationResult> {
    await this.#current(entry.attempt, entry.principal); deadline.throwIfAborted();
    const observed = await deadline.waitFor(this.#options.native.observe(entry.operation!, deadline.signal));
    await this.#current(entry.attempt, entry.principal); deadline.throwIfAborted();
    if (!observed || !["pending", "complete", "unverified"].includes(observed.status) || !Array.isArray(observed.artifacts) || observed.artifacts.length > 64) fail("OPERATION_UNVERIFIED");
    const artifacts = observed.artifacts.map(artifact => {
      plain(artifact); if (typeof artifact.url !== "string" || !isSafeUploadReferenceUrl(artifact.url) || !(artifact.mime_type === null || typeof artifact.mime_type === "string" && artifact.mime_type.length < 100) ||
          typeof artifact.message_id !== "string" || !/^[A-Za-z0-9._~-]{1,160}$/u.test(artifact.message_id) || typeof artifact.message_object_id !== "string" || !/^[A-Za-z0-9._~-]{1,160}$/u.test(artifact.message_object_id)) fail("OPERATION_UNVERIFIED");
      return Object.freeze({ url: artifact.url, mime_type: artifact.mime_type as string | null, message_id: artifact.message_id, message_object_id: artifact.message_object_id });
    });
    const diagnostic = observed.diagnostic;
    if (diagnostic !== undefined && (!["HTTP_REJECTED", "TRANSPORT_UNVERIFIED", "ACK_UNVERIFIED"].includes(diagnostic.category) ||
        (diagnostic.http_status !== undefined && (!Number.isInteger(diagnostic.http_status) || diagnostic.http_status < 100 || diagnostic.http_status > 599)))) fail("OPERATION_UNVERIFIED");
    entry.result = result(entry.id, entry.description, observed.status === "complete" && artifacts.length ? "completed" : observed.status === "pending" ? "pending" : "unverified", "OBSERVED", artifacts, diagnostic);
    return entry.result;
  }
  async #principal(attempt: string) { this.#assertOpen(); if (this.#invalidating.has(attempt)) fail("PRINCIPAL_NOT_LINKED");
    try { return await resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: attempt, linkService: this.#options.linkService }); }
    catch { return fail("PRINCIPAL_NOT_LINKED"); } }
  async #current(attempt: string, expected: Readonly<GenerationPrincipalRef>) { if (!sameGenerationPrincipal(await this.#principal(attempt), expected)) fail("PRINCIPAL_NOT_LINKED"); }
  #run<T>(attempt: string, signal: AbortSignal | undefined, work: (deadline: AbsoluteRequestDeadline) => Promise<T>): Promise<T> {
    this.#assertOpen(); if (this.#active.size >= MAX_ACTIVE || this.#invalidating.has(attempt) || signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("SERVICE_BUSY");
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const deadline = new AbsoluteRequestDeadline(this.#timeout, combined, () => new OwnerCurrentVideoGenerationError("OPERATION_UNVERIFIED"));
    let run: ActiveRun; const promise = Promise.resolve().then(() => work(deadline)).finally(() => { deadline.close(); this.#active.delete(run); });
    run = { attempt, controller, promise }; this.#active.add(run); return promise;
  }
  #time() { const now = this.#now(); if (!Number.isSafeInteger(now) || now < 0 || now < this.#lastNow) fail("INVALID_REQUEST"); this.#lastNow = now; return now; }
  #assertOpen() { if (this.#closed) fail("SERVICE_CLOSED"); }
}
function result(id: string, description: Readonly<OwnerCurrentVideoIntentDescription>, status: OwnerCurrentVideoGenerationResult["status"],
  phase: OwnerCurrentVideoGenerationResult["phase"], artifacts: OwnerCurrentVideoGenerationResult["artifacts"], diagnostic?: OwnerCurrentVideoGenerationResult["diagnostic"]): OwnerCurrentVideoGenerationResult {
  return Object.freeze({ status, recovery_id: id, model_id: description.model_id, source_binding: Object.freeze({ profile_sha256: description.source_profile_sha256,
    source_pins: description.source_pins, intent_fingerprint: description.intent_fingerprint }), parameters: description.settings, artifacts: Object.freeze([...artifacts]),
    ...(diagnostic ? { diagnostic: Object.freeze({ category: diagnostic.category, ...(diagnostic.http_status === undefined ? {} : { http_status: diagnostic.http_status }) }) } : {}), phase, backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY" });
}
function fresh(iso: string, now: number) { const time = Date.parse(iso); return Number.isFinite(time) && time <= now + 30000 && time >= now - 30000; }
function decimalLte(left: string, right: string) { if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(left)) return false;
  const [a = "0", b = ""] = left.split("."), [c = "0", d = ""] = right.split(".");
  return a.length !== c.length ? a.length < c.length : a !== c ? a < c : b.padEnd(Math.max(b.length, d.length), "0") <= d.padEnd(Math.max(b.length, d.length), "0"); }
function attemptId(value: unknown) { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function referenceSelection(value: unknown): OwnerCurrentVideoGenerateInput["references"] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 50) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value); if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail("INVALID_REQUEST");
  return Object.freeze(Array.from({ length: value.length }, (_, index) => { const slot = descriptors[String(index)]; if (!slot || !Object.hasOwn(slot, "value")) fail("INVALID_REQUEST");
    const row = exact(slot.value, ["reference_handle", "role"]); if (typeof row.reference_handle !== "string" || !HANDLE.test(row.reference_handle) || typeof row.role !== "string" ||
      !["image", "video", "audio", "file", "first_frame", "last_frame", "first_clip"].includes(row.role)) fail("INVALID_REQUEST");
    return Object.freeze({ reference_handle: row.reference_handle, role: row.role as OwnerCurrentVideoReferenceRole }); }));
}
function plain(value: unknown): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
  Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null || Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key =>
    typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) fail("INVALID_REQUEST"); }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> { plain(value);
  const keys = Object.keys(value); if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) fail("INVALID_REQUEST"); return { ...value }; }
function dataMethod(value: object, name: string): unknown { let current: object | null = value;
  for (let depth = 0; current && depth < 3; depth++, current = Object.getPrototypeOf(current)) { if (types.isProxy(current)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, name); if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor.value : undefined; } return undefined; }
function fail(code: OwnerCurrentVideoGenerationErrorCode): never { throw new OwnerCurrentVideoGenerationError(code); }
