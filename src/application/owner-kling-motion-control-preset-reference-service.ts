import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { isAbsolute } from "node:path";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxChatHttpClient, readOwnerKlingMotionControlPresetForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerKlingMotionControlPresetEntryContext } from "../adapter/syntx/kling-motion-control-preset-context.js";
import { createOwnerKlingMotionControlVideoProbe, releaseTrustedOwnerKlingMotionControlVideoProbeResult } from "./owner-kling-motion-control-video-probe.js";
import type { OwnerKlingMotionControlVideoMimeType } from "./owner-kling-motion-control-video-probe.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^kling_motion_control_preset_video_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000, MAX_RECORDS = 128, MAX_PENDING = 4, MAX_BYTES = 100 * 1024 * 1024;
const NATIVE_GET = SyntxChatHttpClient.prototype.listKlingMotionControlPresets;
const NATIVE_READER = readOwnerKlingMotionControlPresetForClient;
const RESOLUTIONS = new WeakMap<object, { service: OwnerKlingMotionControlPresetReferenceService; record: VideoRecord }>();

export interface OwnerKlingMotionControlPresetReferenceServiceOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown; readonly ffprobePath: string;
  readonly fetchImpl?: typeof fetch; readonly now?: () => number; readonly timeoutMs?: number;
}
export interface OwnerKlingMotionControlPresetVideoReceipt {
  readonly status: "selected_video_probed"; readonly preset_video_handle: string; readonly model_id: "kling_motion_control";
  readonly variant: "audio" | "noaudio"; readonly mime_type: OwnerKlingMotionControlVideoMimeType; readonly size: number; readonly sha256: string; readonly width: number; readonly height: number;
  readonly duration_seconds: number; readonly expires_in_seconds: number;
  readonly metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED"; readonly generation_permit: false;
}
export interface OwnerKlingMotionControlPresetVideoResolution {
  readonly model_id: "kling_motion_control"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string; readonly preset_video: Omit<OwnerKlingMotionControlPresetVideoReceipt, "status" | "expires_in_seconds" | "metadata_confidence">;
  readonly expires_at: number; readonly epoch: number; readonly generation_permit: false;
}
export type OwnerKlingMotionControlNativePresetVideoConsumer<T> =
  (client: SyntxChatHttpClient, context: OwnerKlingMotionControlPresetVideoContext) => T;
export interface OwnerKlingMotionControlPresetVideoContext { readonly status: "native_service_preset_video"; }
export type OwnerKlingMotionControlPresetReferenceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" |
  "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED" | "PRESET_UNAVAILABLE" |
  "PRESET_ORIGIN_UNVERIFIED" | "DOWNLOAD_REJECTED" | "DOWNLOAD_LIMIT_EXCEEDED" | "VIDEO_UNVERIFIED" | "REFERENCE_EXPIRED";
export class OwnerKlingMotionControlPresetReferenceServiceError extends Error {
  constructor(readonly code: OwnerKlingMotionControlPresetReferenceErrorCode) {
    super("The selected Kling Motion Control preset video could not be safely established."); this.name = "OwnerKlingMotionControlPresetReferenceServiceError";
  }
}
interface Operation { readonly attemptId: string; readonly controller: AbortController; readonly epoch: number; readonly done: Promise<void>; finish(): void; remove(): void; }
interface VideoRecord {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly library: OwnerKlingMotionControlPresetLibraryContext; readonly entry: OwnerKlingMotionControlPresetEntryContext;
  readonly variant: "audio" | "noaudio"; readonly context: OwnerKlingMotionControlPresetVideoContext;
  readonly receipt: OwnerKlingMotionControlPresetVideoReceipt; readonly expiresAt: number; readonly epoch: number;
  readonly uri: string; readonly hash: string; readonly duration: number; readonly selectionKey: string;
}
interface PresetRecord { readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly library: OwnerKlingMotionControlPresetLibraryContext; readonly entry: OwnerKlingMotionControlPresetEntryContext; readonly name: string;
  readonly availability: Readonly<{ audio: boolean; noaudio: boolean }>; readonly expiresAt: number; readonly epoch: number; }
interface PendingSelection { readonly promise: Promise<OwnerKlingMotionControlPresetVideoReceipt>; resolve(value: OwnerKlingMotionControlPresetVideoReceipt): void; reject(error: unknown): void; }
interface OwnerKlingMotionControlPresetLibraryContext { readonly status: "native_preset_library"; }
const CONTEXTS = new WeakMap<object, { service: OwnerKlingMotionControlPresetReferenceService; record: VideoRecord }>();

/** Owner-scoped handles for a real selected service preset video. No generation authority. */
export class OwnerKlingMotionControlPresetReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown; readonly #probe: ReturnType<typeof createOwnerKlingMotionControlVideoProbe>;
  readonly #fetch: typeof fetch; readonly #now: () => number; readonly #timeoutMs: number;
  readonly #records = new Map<string, VideoRecord>(); readonly #byAttempt = new Map<string, Set<string>>();
  readonly #presets = new Map<string, PresetRecord>(); readonly #presetsByAttempt = new Map<string, Set<string>>();
  readonly #selectionKeys = new Map<string, string>(); readonly #pendingSelections = new Map<string, PendingSelection>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>(); readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #epochs = new Map<string, number>(); readonly #pending = new Map<string, Set<Operation>>();
  readonly #invalidating = new Set<string>(); readonly #invalidations = new Map<string, Promise<void>>();
  #pendingCount = 0; #lastNow = -1; #closed = false; #closing: Promise<void> | undefined;
  constructor(input: OwnerKlingMotionControlPresetReferenceServiceOptions | unknown) {
    const f = exactRecord(input, ["binding", "linkService", "resolveClient", "ffprobePath"], ["fetchImpl", "now", "timeoutMs"]);
    if (typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) || typeof f.ffprobePath !== "string" || !isAbsolute(f.ffprobePath) || f.ffprobePath.includes("\0") ||
      !isObject(f.linkService) || typeof dataMethod(f.linkService, "getStatus") !== "function" ||
      (f.fetchImpl !== undefined && typeof f.fetchImpl !== "function") || (f.now !== undefined && typeof f.now !== "function") ||
      (f.timeoutMs !== undefined && (!Number.isSafeInteger(f.timeoutMs) || (f.timeoutMs as number) < 1 || (f.timeoutMs as number) > 30_000))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding); this.#linkService = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = f.resolveClient as (attemptId: string) => unknown; this.#probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath: f.ffprobePath });
    this.#fetch = (f.fetchImpl as typeof fetch | undefined) ?? fetch; this.#now = (f.now as (() => number) | undefined) ?? Date.now;
    this.#timeoutMs = (f.timeoutMs as number | undefined) ?? 30_000; Object.freeze(this);
  }

  async listPresets(input: unknown, signal?: AbortSignal) {
    const request = attemptInput(input); const op = this.#begin(request.attemptId, signal);
    try {
      const principal = await this.#principal(request.attemptId); this.#throw(op); this.#remember(request.attemptId, principal);
      const client = await this.#client(request.attemptId, op); const library = await Reflect.apply(NATIVE_GET, client, [op.controller.signal]);
      this.#throw(op); const latest = await this.#principal(request.attemptId); const latestClient = await this.#client(request.attemptId, op); this.#throw(op);
      if (!sameGenerationPrincipal(principal, latest) || client !== latestClient) { this.#revoke(request.attemptId, op); fail("PRINCIPAL_NOT_LINKED"); }
      this.#purgeExpired();
      if (library.entries.length > MAX_RECORDS - this.#presets.size - this.#records.size) fail("CAPACITY_EXCEEDED");
      const expiresAt = this.#time() + TTL;
      const presets = library.entries.map((entry) => {
        const handle = `kling_motion_control_preset_${entry.index}_${randomUUID()}`;
        const record: PresetRecord = Object.freeze({ handle, attemptId: request.attemptId, principal, client, library: library.context,
          entry: entry.context, name: entry.name, availability: entry.availability, expiresAt, epoch: op.epoch });
        this.#presets.set(handle, record); const handles = this.#presetsByAttempt.get(request.attemptId) ?? new Set<string>(); handles.add(handle); this.#presetsByAttempt.set(request.attemptId, handles);
        return Object.freeze({ preset_handle: handle, name: entry.name, availability: entry.availability,
          gaps: library.gaps.filter((gap) => gap.index === entry.index), origin_confidence: "R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY" as const });
      });
      return Object.freeze({ attempt_id: request.attemptId, presets: Object.freeze(presets), gaps: library.gaps,
        origin_confidence: "R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY" as const });
    } catch (error) { if (error instanceof OwnerKlingMotionControlPresetReferenceServiceError) throw error; fail("PRESET_UNAVAILABLE"); }
    finally { this.#finish(op); }
  }

  async selectPreset(input: unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlPresetVideoReceipt> {
    const request = selectionInput(input); const op = this.#begin(request.attemptId, signal); let bytes: Buffer | undefined, selectionKey: string | undefined, claim: PendingSelection | undefined;
    try {
      const principal = await this.#principal(request.attemptId); this.#throw(op); this.#remember(request.attemptId, principal);
      const client = await this.#client(request.attemptId, op); const preset = this.#presets.get(request.preset_handle);
      if (!preset || preset.attemptId !== request.attemptId || preset.client !== client || preset.epoch !== op.epoch || preset.expiresAt <= this.#time() ||
        !preset.availability[request.variant]) fail("PRESET_UNAVAILABLE");
      const { library, entry } = preset;
      const native = NATIVE_READER(client, entry, request.variant); if (!native) fail("PRESET_UNAVAILABLE");
      const uri = native.url; if (!safePresetUrl(uri)) fail("PRESET_ORIGIN_UNVERIFIED");
      selectionKey = JSON.stringify([principal.tenant_id, principal.subject_id, principal.connection_id, request.attemptId, request.preset_handle, request.variant]);
      const knownHandle = this.#selectionKeys.get(selectionKey), known = knownHandle ? this.#records.get(knownHandle) : undefined;
      if (known && this.#live(known)) return known.receipt;
      if (knownHandle) this.#selectionKeys.delete(selectionKey);
      const waiting = this.#pendingSelections.get(selectionKey);
      if (waiting) {
        const receipt = await waitForSignal(waiting.promise, op.controller.signal); this.#throw(op);
        const latestPrincipal = await this.#principal(request.attemptId), latestClient = await this.#client(request.attemptId, op); this.#throw(op);
        const live = this.#records.get(receipt.preset_video_handle);
        if (!sameGenerationPrincipal(principal, latestPrincipal) || latestClient !== client || !live || !this.#live(live)) fail("REFERENCE_EXPIRED");
        return receipt;
      }
      let resolve!: (value: OwnerKlingMotionControlPresetVideoReceipt) => void, reject!: (error: unknown) => void;
      const promise = new Promise<OwnerKlingMotionControlPresetVideoReceipt>((res, rej) => { resolve = res; reject = rej; });
      void promise.catch(() => undefined); claim = { promise, resolve, reject }; this.#pendingSelections.set(selectionKey, claim);
      bytes = await this.#download(uri, op); this.#throw(op);
      const mime = sniffMime(bytes); if (!mime) fail("VIDEO_UNVERIFIED");
      const probe = await this.#probe.probe({ filename: mime === "video/mp4" ? "selected-preset.mp4" : "selected-preset.mov", mime_type: mime, bytes }, { signal: op.controller.signal });
      try {
        this.#throw(op); const latestPrincipal = await this.#principal(request.attemptId); const latestClient = await this.#client(request.attemptId, op); this.#throw(op);
        if (!sameGenerationPrincipal(principal, latestPrincipal) || latestClient !== client || !NATIVE_READER(client, entry, request.variant)) { this.#revoke(request.attemptId, op); fail("PRINCIPAL_NOT_LINKED"); }
        if (this.#records.size + this.#presets.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
        const now = this.#time(), expiresAt = Math.min(preset.expiresAt, now + TTL);
        if (expiresAt <= now) fail("PRESET_UNAVAILABLE");
        const handle = `kling_motion_control_preset_video_${randomUUID()}`;
        const receipt = Object.freeze({ status: "selected_video_probed" as const, preset_video_handle: handle, model_id: "kling_motion_control" as const,
          variant: request.variant, mime_type: probe.mime_type, size: probe.bytes_copied, sha256: probe.source_sha256, width: probe.metadata.width, height: probe.metadata.height,
          duration_seconds: probe.metadata.duration_seconds, expires_in_seconds: Math.floor((expiresAt - now) / 1000), metadata_confidence: probe.metadata_confidence, generation_permit: false as const });
        const context: OwnerKlingMotionControlPresetVideoContext = Object.freeze({ status: "native_service_preset_video" });
        const record: VideoRecord = Object.freeze({ handle, attemptId: request.attemptId, principal, client, library, entry, variant: request.variant,
          context, receipt, expiresAt, epoch: op.epoch, uri, hash: probe.source_sha256, duration: probe.metadata.duration_seconds, selectionKey: selectionKey! });
        this.#records.set(handle, record); const handles = this.#byAttempt.get(request.attemptId) ?? new Set<string>(); handles.add(handle); this.#byAttempt.set(request.attemptId, handles);
        CONTEXTS.set(context, { service: this, record }); this.#selectionKeys.set(selectionKey!, handle); claim!.resolve(receipt); return receipt;
      } finally { releaseTrustedOwnerKlingMotionControlVideoProbeResult(probe); }
    } catch (error) { claim?.reject(error); if (error instanceof OwnerKlingMotionControlPresetReferenceServiceError) throw error; return fail("VIDEO_UNVERIFIED"); }
    finally { if (selectionKey && claim && this.#pendingSelections.get(selectionKey) === claim) this.#pendingSelections.delete(selectionKey); bytes?.fill(0); this.#finish(op); }
  }

  async resolvePresetVideo(input: unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlPresetVideoResolution> {
    const request = handleInput(input); const op = this.#begin(request.attempt_id, signal);
    try { const record = this.#records.get(request.preset_video_handle); if (!record || record.attemptId !== request.attempt_id || !this.#live(record)) fail("REFERENCE_EXPIRED");
      await this.#verify(record, op); const value = Object.freeze({ model_id: "kling_motion_control" as const, principal: record.principal,
        attempt_id: request.attempt_id, preset_video: safeReceipt(record), expires_at: record.expiresAt, epoch: record.epoch, generation_permit: false as const });
      RESOLUTIONS.set(value, { service: this, record }); return value;
    } finally { this.#finish(op); }
  }
  withNativePresetVideo<T>(value: unknown, input: unknown, consume: OwnerKlingMotionControlNativePresetVideoConsumer<T>): T {
    const req = handleInput(input); if (typeof consume !== "function" || types.isProxy(consume) || !isObject(value)) fail("REFERENCE_EXPIRED");
    const owned = RESOLUTIONS.get(value); if (!owned || owned.service !== this || owned.record.handle !== req.preset_video_handle || owned.record.attemptId !== req.attempt_id) fail("REFERENCE_EXPIRED");
    this.#assert(owned.record); const result = consume(owned.record.client, owned.record.context); this.#assert(owned.record); return result;
  }
  invalidateAttempt(input: unknown): Promise<void> {
    if (typeof input !== "string" || !ATTEMPT.test(input)) return Promise.resolve(); const old = this.#invalidations.get(input); if (old) return old;
    this.#revoke(input); const ops = [...(this.#pending.get(input) ?? [])]; for (const op of ops) op.controller.abort();
    const done = Promise.allSettled(ops.map((op) => op.done)).then(() => { this.#principals.delete(input); this.#clients.delete(input); this.#invalidating.delete(input); this.#invalidations.delete(input); });
    this.#invalidations.set(input, done); return done;
  }
  close(): Promise<void> { if (this.#closing) return this.#closing; this.#closed = true;
    this.#closing = Promise.allSettled([...new Set([...this.#byAttempt.keys(), ...this.#presetsByAttempt.keys(), ...this.#pending.keys()])].map((id) => this.invalidateAttempt(id))).then(() => { this.#records.clear(); this.#byAttempt.clear(); this.#presets.clear(); this.#presetsByAttempt.clear(); this.#selectionKeys.clear(); this.#pendingSelections.clear(); }); return this.#closing; }
  isLiveContext(context: unknown): boolean {
    if (!isObject(context)) return false;
    const owned = CONTEXTS.get(context);
    if (!owned || owned.service !== this || !this.#live(owned.record)) return false;
    return NATIVE_READER(owned.record.client, owned.record.entry, owned.record.variant)?.url === owned.record.uri;
  }

  #begin(id: string, parent?: AbortSignal): Operation { if (this.#closed) fail("SERVICE_CLOSED"); if (this.#invalidating.has(id) || this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(), onAbort = () => controller.abort(parent?.reason); if (parent?.aborted) onAbort(); else parent?.addEventListener("abort", onAbort, { once: true });
    let finish!: () => void; const done = new Promise<void>((r) => { finish = r; }); const op = { attemptId: id, controller, epoch: this.#epochs.get(id) ?? 0, done, finish,
      remove: () => parent?.removeEventListener("abort", onAbort) }; const set = this.#pending.get(id) ?? new Set<Operation>(); set.add(op); this.#pending.set(id, set); this.#pendingCount++; return op; }
  #finish(op: Operation) { op.remove(); const set = this.#pending.get(op.attemptId); set?.delete(op); if (!set?.size) this.#pending.delete(op.attemptId); this.#pendingCount--; op.finish(); if (!set?.size && this.#invalidating.has(op.attemptId) && !this.#invalidations.has(op.attemptId)) this.#invalidating.delete(op.attemptId); }
  #throw(op: Operation) { if (this.#closed) fail("SERVICE_CLOSED"); if (op.controller.signal.aborted || op.epoch !== (this.#epochs.get(op.attemptId) ?? 0)) fail("REQUEST_ABORTED"); }
  async #principal(id: string) { try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: id, linkService: this.#linkService }); } catch { fail("PRINCIPAL_NOT_LINKED"); } }
  async #client(id: string, op?: Operation): Promise<SyntxChatHttpClient> { let v: unknown; try { v = await this.#resolveClient(id); } catch { fail("PROFILE_BINDING_MISMATCH"); }
    if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== SyntxChatHttpClient.prototype || Object.hasOwn(v, "listKlingMotionControlPresets") || SyntxChatHttpClient.prototype.listKlingMotionControlPresets !== NATIVE_GET) fail("PROFILE_BINDING_MISMATCH");
    const old = this.#clients.get(id); if (old && old !== v) { this.#revoke(id, op); fail("PROFILE_BINDING_MISMATCH"); } this.#clients.set(id, v as SyntxChatHttpClient); return v as SyntxChatHttpClient; }
  #remember(id: string, p: Readonly<GenerationPrincipalRef>) { const old = this.#principals.get(id); if (old && !sameGenerationPrincipal(old, p)) fail("PRINCIPAL_NOT_LINKED"); this.#principals.set(id, p); }
  async #verify(record: VideoRecord, op: Operation) { const p = await this.#principal(record.attemptId); this.#throw(op); const c = await this.#client(record.attemptId, op); this.#throw(op);
    if (!sameGenerationPrincipal(p, record.principal) || c !== record.client || !this.#live(record) || !NATIVE_READER(c, record.entry, record.variant)) { this.#revoke(record.attemptId, op); fail("REFERENCE_EXPIRED"); } }
  #assert(record: VideoRecord) { if (!this.#live(record) || !this.isLiveContext(record.context) || this.#clients.get(record.attemptId) !== record.client) fail("REFERENCE_EXPIRED"); }
  #live(r: VideoRecord) { return !this.#closed && this.#records.get(r.handle) === r && r.expiresAt > this.#time() && r.epoch === (this.#epochs.get(r.attemptId) ?? 0); }
  #purgeExpired() { const now = this.#time(); for (const [handle, r] of this.#records) if (r.expiresAt <= now) { this.#records.delete(handle); this.#selectionKeys.delete(r.selectionKey); this.#byAttempt.get(r.attemptId)?.delete(handle); }
    for (const [handle, p] of this.#presets) if (p.expiresAt <= now) { this.#presets.delete(handle); this.#presetsByAttempt.get(p.attemptId)?.delete(handle); } }
  #revoke(id: string, exclude?: Operation) { if (!this.#invalidating.has(id)) this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1); this.#invalidating.add(id);
    for (const h of this.#byAttempt.get(id) ?? []) { const record = this.#records.get(h); if (record) this.#selectionKeys.delete(record.selectionKey); this.#records.delete(h); } this.#byAttempt.delete(id);
    for (const h of this.#presetsByAttempt.get(id) ?? []) this.#presets.delete(h); this.#presetsByAttempt.delete(id); this.#principals.delete(id); this.#clients.delete(id);
    for (const op of this.#pending.get(id) ?? []) if (op !== exclude) op.controller.abort(); }
  #time() { const n = this.#now(); if (!Number.isFinite(n) || n < 0 || n < this.#lastNow) fail("SERVICE_CLOSED"); this.#lastNow = n; return n; }
  async #download(uri: string, op: Operation): Promise<Buffer> { const controller = new AbortController(); const abort = () => controller.abort(op.controller.signal.reason);
    if (op.controller.signal.aborted) abort(); else op.controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try { const response = await fetchWithAbort(this.#fetch(uri, { method: "GET", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", signal: controller.signal }), controller.signal);
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); fail(op.controller.signal.aborted ? "REQUEST_ABORTED" : "DOWNLOAD_REJECTED"); }
      if (response.status !== 200 || response.redirected || response.url !== uri || response.type === "opaqueredirect" || !response.body) {
        void response.body?.cancel().catch(() => undefined); fail("DOWNLOAD_REJECTED");
      }
      const length = response.headers.get("content-length"); if (length !== null && (!/^\d+$/u.test(length) || Number(length) < 1 || Number(length) > MAX_BYTES)) {
        void response.body.cancel().catch(() => undefined); fail("DOWNLOAD_LIMIT_EXCEEDED");
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0, completed = false, output: Buffer | undefined, returned = false;
      const cancelReader = () => { void reader.cancel().catch(() => undefined); };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      try {
        for (;;) {
          this.#throw(op);
          const { done, value } = await readWithAbort(reader, controller.signal);
          if (controller.signal.aborted) fail(op.controller.signal.aborted ? "REQUEST_ABORTED" : "DOWNLOAD_REJECTED");
          if (done) { completed = true; break; }
          size += value.byteLength;
          if (size > MAX_BYTES) { value.fill(0); fail("DOWNLOAD_LIMIT_EXCEEDED"); }
          chunks.push(value);
        }
        if (!size) fail("DOWNLOAD_REJECTED");
        output = Buffer.allocUnsafe(size); let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
        returned = true; return output;
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        if (!completed) cancelReader();
        for (const chunk of chunks) chunk.fill(0);
        if (!returned) output?.fill(0);
        try { reader.releaseLock(); } catch { /* A source may retain a pending read after cancellation. */ }
      }
    } catch (e) { if (e instanceof OwnerKlingMotionControlPresetReferenceServiceError) throw e; fail(op.controller.signal.aborted ? "REQUEST_ABORTED" : "DOWNLOAD_REJECTED"); }
    finally { clearTimeout(timer); op.controller.signal.removeEventListener("abort", abort); } }
}

/** Private reader for a currently live genuine service-preset resolution. */
export function readOwnerKlingMotionControlPresetVideoReferenceForClient(client: unknown, context: unknown) {
  if (!isObject(client) || types.isProxy(client) || !isObject(context) || types.isProxy(context)) return null;
  const owned = CONTEXTS.get(context); if (!owned || owned.record.client !== client || !owned.service.isLiveContext(context)) return null;
  return Object.freeze({ uri: owned.record.uri, sha256: owned.record.hash, duration_seconds: owned.record.duration, variant: owned.record.variant });
}

function safePresetUrl(s: string) { try { const u = new URL(s); return u.protocol === "https:" && u.hostname === "r2.syntx.ai" && !u.username && !u.password && !u.port && u.hash === ""; } catch { return false; } }
function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error("aborted")); signal.addEventListener("abort", onAbort, { once: true }); });
  return Promise.race([reader.read(), aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}
function fetchWithAbort(promise: Promise<Response>, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) { void promise.then((response) => response.body?.cancel().catch(() => undefined), () => undefined); return Promise.reject(new Error("aborted")); }
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error("aborted")); signal.addEventListener("abort", onAbort, { once: true }); });
  return Promise.race([promise, aborted]).catch((error: unknown) => {
    if (signal.aborted) void promise.then((response) => response.body?.cancel().catch(() => undefined), () => undefined);
    throw error;
  }).finally(() => signal.removeEventListener("abort", onAbort));
}
function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new OwnerKlingMotionControlPresetReferenceServiceError("REQUEST_ABORTED"));
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => reject(new OwnerKlingMotionControlPresetReferenceServiceError("REQUEST_ABORTED")); signal.addEventListener("abort", onAbort, { once: true }); });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}
function sniffMime(b: Uint8Array): OwnerKlingMotionControlVideoMimeType | null { if (b.length < 12 || String.fromCharCode(...b.subarray(4, 8)) !== "ftyp") return null;
  const brand = String.fromCharCode(...b.subarray(8, 12)); return ["qt  ", "mqt "].includes(brand) ? "video/quicktime" : ["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "3gp4", "3gp5", "3gp6"].includes(brand) ? "video/mp4" : null; }
function safeReceipt(r: VideoRecord): OwnerKlingMotionControlPresetVideoResolution["preset_video"] { return Object.freeze({ preset_video_handle: r.handle, model_id: "kling_motion_control", variant: r.variant, mime_type: r.receipt.mime_type, size: r.receipt.size, sha256: r.receipt.sha256, width: r.receipt.width, height: r.receipt.height, duration_seconds: r.receipt.duration_seconds, generation_permit: false }); }
function attemptInput(v: unknown) { const f = exactRecord(v, ["attemptId"]); if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) fail("INVALID_REQUEST"); return f as { attemptId: string }; }
function selectionInput(v: unknown) { const f = exactRecord(v, ["attemptId", "preset_handle", "variant"]); if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.preset_handle !== "string" || (f.variant !== "audio" && f.variant !== "noaudio")) fail("INVALID_REQUEST"); return f as { attemptId: string; preset_handle: string; variant: "audio" | "noaudio" }; }
function handleInput(v: unknown) { const f = exactRecord(v, ["attempt_id", "preset_video_handle"]); if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.preset_video_handle !== "string" || !HANDLE.test(f.preset_video_handle)) fail("INVALID_REQUEST"); return f as { attempt_id: string; preset_video_handle: string }; }
function exactRecord(v: unknown, required: readonly string[], optional: readonly string[] = []) { if (!isObject(v)) fail("INVALID_REQUEST"); const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds), allowed = [...required, ...optional]; if (![Object.prototype, null].includes(Object.getPrototypeOf(v)) || required.some((k) => !Object.hasOwn(ds, k)) || keys.some((k) => typeof k !== "string" || !allowed.includes(k) || !("value" in ds[k]!) || !ds[k]!.enumerable)) fail("INVALID_REQUEST"); const o: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) o[k] = ds[k]!.value; return o; }
function snapshotBinding(v: unknown): Readonly<AuthBinding> { const f = exactRecord(v, ["tenant_id", "subject"]); if (typeof f.tenant_id !== "string" || !f.tenant_id || typeof f.subject !== "string" || !f.subject) fail("INVALID_REQUEST"); return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function isObject(v: unknown): v is object { return !!v && typeof v === "object" && !Array.isArray(v) && !types.isProxy(v); }
function dataMethod(o: object, k: string): unknown { for (let p: object | null = o; p; p = Object.getPrototypeOf(p) as object | null) { const d = Object.getOwnPropertyDescriptor(p, k); if (d) return "value" in d ? d.value : undefined; } return undefined; }
function fail(c: OwnerKlingMotionControlPresetReferenceErrorCode): never { throw new OwnerKlingMotionControlPresetReferenceServiceError(c); }
