import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { OwnerActTwoUploadDestination } from "../adapter/syntx/owner-acttwo-image-context.js";
import { readOwnerActTwoPerformanceVideoReference, type OwnerActTwoPerformanceVideoUploadContext } from "../adapter/syntx/owner-acttwo-video-context.js";
import { readValidatedOwnerActTwoPerformanceVideo,
  releaseValidatedOwnerActTwoPerformanceVideo, createOwnerActTwoPerformanceVideoValidator,
  type ValidatedOwnerActTwoPerformanceVideo } from "./owner-acttwo-video-policy.js";
import { OwnerActTwoVideoPolicyError } from "./owner-acttwo-video-policy.js";
import { getOwnerActTwoSourceProfile } from "./owner-acttwo-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^acttwo_performance_video_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerActTwoPerformanceVideo");
const REFERENCES = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export interface OwnerActTwoVideoReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly uploadDestination: OwnerActTwoUploadDestination;
  readonly ffprobePath: string;
  readonly now?: () => number;
}
export interface OwnerActTwoPerformanceVideoUploadInput {
  readonly attemptId: string;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly bytes: Uint8Array;
}
export interface OwnerActTwoPerformanceVideoReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: "acttwo";
  readonly media_type: "video";
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly measured_duration_seconds: 5;
  readonly expires_in_seconds: number;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS";
  readonly upload_authority: false;
  readonly generation_permit: false;
}
export interface OwnerActTwoOwnedPerformanceVideo {
  readonly attempt_id: string;
  readonly model_id: "acttwo";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly performance_video: Readonly<{
    reference_handle: string; mime_type: "video/mp4"; size: number; sha256: string; width: number; height: number; measured_duration_seconds: 5;
  }>;
  readonly generation_permit: false;
}
export type OwnerActTwoVideoReferenceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" |
  "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "VALIDATION_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "REFERENCE_ALREADY_ATTACHED";
export class OwnerActTwoVideoReferenceError extends Error {
  constructor(readonly code: OwnerActTwoVideoReferenceErrorCode) {
    super("The owner ActTwo performance-video reference is unavailable.");
    this.name = "OwnerActTwoVideoReferenceError";
  }
}

interface Entry {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly context: OwnerActTwoPerformanceVideoUploadContext;
  readonly epoch: number; readonly expiresAt: number;
}
interface Pending { readonly controller: AbortController; readonly signal: AbortSignal; readonly done: Promise<void>; readonly finish: () => void }
interface OwnedState {
  readonly service: OwnerActTwoPerformanceVideoReferenceService; readonly entry: Entry; readonly client: SyntxChatHttpClient;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attemptId: string; readonly expiresAt: number; readonly epoch: number;
}
interface UploadSnapshot { readonly attemptId: string; readonly filename: string; readonly mimeType: "video/mp4"; readonly bytes: Buffer }
interface ResolveSnapshot { readonly attemptId: string; readonly referenceHandle: string }

/** Process-local, measured ActTwo performance-video vault. It never returns a URL to MCP. */
export class OwnerActTwoPerformanceVideoReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown; readonly #destination: OwnerActTwoUploadDestination;
  readonly #validate: ReturnType<typeof createOwnerActTwoPerformanceVideoValidator>; readonly #now: () => number;
  readonly #entries = new Map<string, Entry>(); readonly #byAttempt = new Map<string, string>(); readonly #epochs = new Map<string, number>();
  readonly #pending = new Map<string, Pending>(); readonly #unknown = new Set<string>();
  #lastTime = -1; #closed = false; #closing: Promise<void> | undefined;

  constructor(options: OwnerActTwoVideoReferenceServiceOptions) {
    if (!options || types.isProxy(options) || !genuineLinks(options.linkService) || typeof options.resolveClient !== "function" ||
        types.isProxy(options.resolveClient) || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden") ||
        typeof options.ffprobePath !== "string" || !options.ffprobePath ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now))) || typeof NATIVE_UPLOAD !== "function") fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }); this.#links = options.linkService; this.#resolveClient = options.resolveClient;
    this.#destination = options.uploadDestination; this.#validate = createOwnerActTwoPerformanceVideoValidator(options.ffprobePath);
    this.#now = options.now ?? Date.now; SERVICES.add(this); Object.freeze(this);
  }

  async uploadPerformanceVideo(input: unknown, signalInput?: AbortSignal): Promise<OwnerActTwoPerformanceVideoReceipt> {
    this.#assertOpen(); const request = snapshotUpload(input), signal = exactSignal(signalInput);
    let validated: Readonly<ValidatedOwnerActTwoPerformanceVideo> | undefined; let semantic = "", invoked = false;
    const pending = this.#begin(request.attemptId, signal);
    try {
      const principal = await this.#principal(request.attemptId); this.#stopped(pending);
      const client = clientSnapshot(this.#resolveClient(request.attemptId));
      try { validated = await this.#validate.validate({ model_id: "acttwo", filename: request.filename, mime_type: request.mimeType, bytes: request.bytes }, pending.signal); }
      catch (error) { this.#stopped(pending); if (error instanceof OwnerActTwoVideoPolicyError && error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED"); fail("VALIDATION_REJECTED"); }
      const local = readValidatedOwnerActTwoPerformanceVideo(validated); if (!local) fail("VALIDATION_REJECTED");
      const metadata = Object.freeze({ model_id: local.model_id, filename: local.filename, mime_type: local.mime_type, size: local.size,
        sha256: local.sha256, width: local.width, height: local.height, measured_duration_seconds: local.measured_duration_seconds });
      local.bytes.fill(0);
      semantic = schemaHash({ tenant: principal.tenant_id, subject: principal.subject_id, model_id: "acttwo", role: "performance_video",
        sha256: metadata.sha256, size: metadata.size, mime_type: metadata.mime_type });
      if (this.#unknown.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#prune(this.#time());
      const oldHandle = this.#byAttempt.get(request.attemptId); if (oldHandle && this.#entries.has(oldHandle)) fail("REFERENCE_ALREADY_ATTACHED");
      if (this.#entries.size + this.#unknown.size >= MAX_ENTRIES) fail("CAPACITY_EXCEEDED");
      const epoch = this.#epochs.get(request.attemptId) ?? 0, expiresAt = this.#time() + TTL_MS; this.#stopped(pending);
      invoked = true;
      let context: OwnerActTwoPerformanceVideoUploadContext;
      try { context = await SyntxChatHttpClient.prototype.uploadOwnerActTwoPerformanceVideo.call(client,
        { media: validated, destination: this.#destination }, pending.signal); }
      catch { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const reference = readOwnerActTwoPerformanceVideoReference(client, context);
      if (!reference || reference.type !== "video" || !isSafeUploadReferenceUrl(reference.url) || context.model_id !== "acttwo" ||
          context.destination !== this.#destination || context.mime_type !== "video/mp4" || context.size !== metadata.size ||
          context.sha256 !== metadata.sha256 || context.width !== metadata.width || context.height !== metadata.height ||
          context.measured_duration_seconds !== 5) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const current = await this.#principal(request.attemptId);
      if (!sameGenerationPrincipal(principal, current) || clientSnapshot(this.#resolveClient(request.attemptId)) !== client ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const now = this.#time(); if (expiresAt - now < 1_000) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const handle = `acttwo_performance_video_${randomUUID()}`;
      const entry = Object.freeze({ handle, attemptId: request.attemptId, principal, client, context, epoch, expiresAt });
      this.#entries.set(handle, entry); this.#byAttempt.set(request.attemptId, handle);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: "acttwo", media_type: "video", mime_type: "video/mp4",
        size: metadata.size, sha256: metadata.sha256, width: metadata.width, height: metadata.height, measured_duration_seconds: 5,
        expires_in_seconds: Math.floor((expiresAt - now) / 1000), probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS",
        upload_authority: false, generation_permit: false });
    } catch (error) {
      if (invoked && semantic) this.#unknown.add(semantic);
      if (error instanceof OwnerActTwoVideoReferenceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("VALIDATION_REJECTED");
    } finally {
      if (validated) releaseValidatedOwnerActTwoPerformanceVideo(validated);
      request.bytes.fill(0); this.#finish(request.attemptId, pending);
    }
  }

  async resolvePerformanceVideo(input: unknown, signalInput?: AbortSignal): Promise<OwnerActTwoOwnedPerformanceVideo> {
    this.#assertOpen(); const request = exactResolve(input), signal = exactSignal(signalInput);
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const principal = await this.#principal(request.attemptId), entry = this.#entries.get(request.referenceHandle);
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (!entry || entry.attemptId !== request.attemptId || !sameGenerationPrincipal(entry.principal, principal)) fail("REFERENCE_UNAVAILABLE");
    const now = this.#time(); if (entry.expiresAt <= now) { this.#drop(entry); fail("REFERENCE_EXPIRED"); }
    if (entry.epoch !== (this.#epochs.get(entry.attemptId) ?? 0) || clientSnapshot(this.#resolveClient(entry.attemptId)) !== entry.client) fail("REFERENCE_UNAVAILABLE");
    const reference = readOwnerActTwoPerformanceVideoReference(entry.client, entry.context); if (!reference || reference.type !== "video") fail("REFERENCE_UNAVAILABLE");
    const current = await this.#principal(request.attemptId); if (!sameGenerationPrincipal(principal, current) || entry.expiresAt <= this.#time()) fail("REFERENCE_EXPIRED");
    const context = entry.context;
    const owned = Object.freeze({ attempt_id: request.attemptId, model_id: "acttwo" as const, principal,
      profile_sha256: getOwnerActTwoSourceProfile().source_sha256, expires_at: entry.expiresAt, epoch: entry.epoch,
      performance_video: Object.freeze({ reference_handle: entry.handle, mime_type: context.mime_type, size: context.size,
        sha256: context.sha256, width: context.width, height: context.height, measured_duration_seconds: 5 as const }), generation_permit: false as const });
    REFERENCES.set(owned, Object.freeze({ service: this, entry, client: entry.client, principal, attemptId: request.attemptId,
      expiresAt: entry.expiresAt, epoch: entry.epoch })); return owned;
  }

  withCapturedPerformanceVideo<T>(ownedInput: unknown, consume: (client: SyntxChatHttpClient, video: Readonly<{
    url: string; sha256: string; size: number; width: number; height: number; mime_type: "video/mp4"; measured_duration_seconds: 5;
  }>) => T): T {
    if (!this.isOwnedPerformanceVideo(ownedInput) || typeof consume !== "function" || types.isProxy(consume)) fail("REFERENCE_UNAVAILABLE");
    const state = REFERENCES.get(ownedInput as object)!, reference = readOwnerActTwoPerformanceVideoReference(state.client, state.entry.context);
    if (!reference) fail("REFERENCE_UNAVAILABLE"); const context = state.entry.context;
    return consume(state.client, Object.freeze({ url: reference.url, sha256: context.sha256, size: context.size,
      width: context.width, height: context.height, mime_type: "video/mp4", measured_duration_seconds: 5 }));
  }

  isOwnedPerformanceVideo(value: unknown): value is OwnerActTwoOwnedPerformanceVideo {
    try {
      if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const state = REFERENCES.get(value); if (!state || state.service !== this || this.#entries.get(state.entry.handle) !== state.entry ||
          state.expiresAt <= this.#time() || state.epoch !== (this.#epochs.get(state.attemptId) ?? 0) ||
          clientSnapshot(this.#resolveClient(state.attemptId)) !== state.client) return false;
      return readOwnerActTwoPerformanceVideoReference(state.client, state.entry.context) !== null;
    } catch { return false; }
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT.test(attemptId)) return; this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    const pending = this.#pending.get(attemptId); pending?.controller.abort(); if (pending) await pending.done;
    const handle = this.#byAttempt.get(attemptId); if (handle) { const entry = this.#entries.get(handle); if (entry) this.#drop(entry); }
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#closing ??= Promise.allSettled([...this.#pending.values()].map(row => { row.controller.abort(); return row.done; })).then(() => {
      this.#entries.clear(); this.#byAttempt.clear(); this.#unknown.clear();
    });
    await this.#closing;
  }
  #begin(attemptId: string, signal: AbortSignal | undefined): Pending {
    if (signal?.aborted) fail("REQUEST_ABORTED"); if (this.#pending.has(attemptId) || this.#pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(); let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const pending = Object.freeze({ controller, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, done, finish });
    this.#pending.set(attemptId, pending); return pending;
  }
  #finish(attemptId: string, pending: Pending): void { if (this.#pending.get(attemptId) === pending) this.#pending.delete(attemptId); pending.finish(); }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links }); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); throw error; }
  }
  #stopped(pending: Pending): void { if (this.#closed) fail("SERVICE_CLOSED"); if (pending.signal.aborted) fail("REQUEST_ABORTED"); }
  #drop(entry: Entry): void { this.#entries.delete(entry.handle); if (this.#byAttempt.get(entry.attemptId) === entry.handle) this.#byAttempt.delete(entry.attemptId); }
  #prune(now: number): void { for (const entry of this.#entries.values()) if (entry.expiresAt <= now) this.#drop(entry); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number { const value = this.#now(); if (!Number.isSafeInteger(value) || value < this.#lastTime) fail("INVALID_REQUEST"); this.#lastTime = value; return value; }
}

export function isOwnerActTwoPerformanceVideoReferenceService(value: unknown): value is OwnerActTwoPerformanceVideoReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerActTwoPerformanceVideoReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(input: unknown): UploadSnapshot {
  const fields = exact(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.filename !== "string" ||
      fields.mime_type !== "video/mp4" || !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, filename: fields.filename, mimeType: "video/mp4", bytes: copyBytes(fields.bytes) });
}
function copyBytes(value: Uint8Array): Buffer {
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) || ["buffer", "byteOffset", "byteLength", "length"].some(key => Object.hasOwn(value, key)) ||
        !BUFFER_GETTER || !OFFSET_GETTER || !LENGTH_GETTER || !ARRAY_BUFFER_LENGTH_GETTER) fail("INVALID_REQUEST");
    const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer, offset = Reflect.apply(OFFSET_GETTER, value, []) as number,
      length = Reflect.apply(LENGTH_GETTER, value, []) as number, backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 16 || length > 20 * 1024 * 1024 || offset + length > backingLength) fail("INVALID_REQUEST");
    const source = new Uint8Array(backing, offset, length), output = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index += 1) output[index] = source[index]!;
    return output;
  } catch { return fail("INVALID_REQUEST"); }
}
function exactResolve(value: unknown): ResolveSnapshot {
  const fields = exact(value, ["attemptId", "reference_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.reference_handle !== "string" || !HANDLE.test(fields.reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, referenceHandle: fields.reference_handle });
}
function exact(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return fail("INVALID_REQUEST"); }
}
function clientSnapshot(value: unknown): SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      Object.hasOwn(value, "uploadOwnerActTwoPerformanceVideo") || typeof NATIVE_UPLOAD !== "function" ||
      Reflect.get(value, "uploadOwnerActTwoPerformanceVideo") !== NATIVE_UPLOAD) fail("PRINCIPAL_NOT_LINKED");
  return value as SyntxChatHttpClient;
}
function genuineLinks(value: unknown): value is Pick<PerUserLinkService, "getStatus"> {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; }
}
function exactSignal(value: unknown): AbortSignal | undefined { if (value === undefined) return undefined; if (!(value instanceof AbortSignal) || types.isProxy(value)) fail("INVALID_REQUEST"); return value; }
function fail(code: OwnerActTwoVideoReferenceErrorCode): never { throw new OwnerActTwoVideoReferenceError(code); }
