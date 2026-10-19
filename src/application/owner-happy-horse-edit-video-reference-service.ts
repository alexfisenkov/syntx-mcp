import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { readOwnerHappyHorseEditVideoReference, type OwnerHappyHorseEditVideoUploadContext,
  type OwnerHappyHorseVideoUploadReference } from "../adapter/syntx/owner-happy-horse-video-context.js";
import { createOwnerHappyHorseEditVideoValidator, readValidatedOwnerHappyHorseEditVideo,
  releaseValidatedOwnerHappyHorseEditVideo, type OwnerHappyHorseEditVideoMimeType, type ValidatedOwnerHappyHorseEditVideo } from "./owner-happy-horse-edit-video-policy.js";
import type { OwnerHappyHorseUploadDestination } from "../adapter/syntx/owner-happy-horse-image-context.js";
import { getOwnerHappyHorseSourceProfile } from "./owner-happy-horse-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^happy_horse_video_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerHappyHorseEditVideo");
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const OWNED = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();
export interface OwnerHappyHorseEditVideoReferenceServiceOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">; readonly resolveClient: (attempt: string) => unknown;
  readonly uploadDestination: OwnerHappyHorseUploadDestination; readonly ffprobePath: string; readonly now?: () => number;
}
export interface OwnerHappyHorseEditVideoUploadInput {
  readonly attemptId: string; readonly filename: string; readonly mime_type: OwnerHappyHorseEditVideoMimeType; readonly bytes: Uint8Array;
}
export interface OwnerHappyHorseEditVideoUploadReceipt {
  readonly status: "uploaded"; readonly reference_handle: string; readonly model_id: "happy_horse_edit"; readonly media_type: "video";
  readonly mime_type: OwnerHappyHorseEditVideoMimeType; readonly size: number; readonly sha256: string; readonly width: number;
  readonly height: number; readonly measured_duration_seconds: number; readonly expires_in_seconds: number;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS";
  readonly local_limit_confidence: "CONSERVATIVE_LOCAL_PROBE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN"; readonly generation_permit: false;
}
export interface OwnerHappyHorseOwnedVideo {
  readonly attempt_id: string; readonly model_id: "happy_horse_edit"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string; readonly expires_at: number; readonly generation_permit: false;
  readonly video: Readonly<{ reference_handle: string; mime_type: OwnerHappyHorseEditVideoMimeType; size: number;
    sha256: string; width: number; height: number; measured_duration_seconds: number }>;
}
export class OwnerHappyHorseEditVideoReferenceError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "UPLOAD_OUTCOME_UNKNOWN" | "VALIDATION_REJECTED" |
    "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "SERVICE_CLOSED") { super("HappyHorse edit video reference is unavailable."); this.name = "OwnerHappyHorseEditVideoReferenceError"; }
}
interface Entry { readonly handle: string; readonly attempt: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly context: OwnerHappyHorseEditVideoUploadContext; readonly expiresAt: number; readonly epoch: number; }
interface OwnedState { readonly service: OwnerHappyHorseEditVideoReferenceService; readonly entry: Entry; readonly client: SyntxChatHttpClient }
export class OwnerHappyHorseEditVideoReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">; readonly #resolveClient: (attempt: string) => unknown;
  readonly #destination: OwnerHappyHorseUploadDestination; readonly #validate: ReturnType<typeof createOwnerHappyHorseEditVideoValidator>;
  readonly #now: () => number; readonly #entries = new Map<string, Entry>(); readonly #epochs = new Map<string, number>();
  readonly #unknown = new Set<string>(); #closed = false; #lastTime = 0;
  constructor(options: OwnerHappyHorseEditVideoReferenceServiceOptions) {
    if (!options || types.isProxy(options) || !genuineLinks(options.linkService) || typeof options.resolveClient !== "function" || types.isProxy(options.resolveClient) ||
        (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden") || typeof options.ffprobePath !== "string" || !options.ffprobePath ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now))) || typeof NATIVE_UPLOAD !== "function") fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }); this.#links = options.linkService; this.#resolveClient = options.resolveClient;
    this.#destination = options.uploadDestination; this.#validate = createOwnerHappyHorseEditVideoValidator(options.ffprobePath);
    this.#now = options.now ?? Date.now; this.#time(); SERVICES.add(this); Object.freeze(this);
  }
  async uploadVideo(input: unknown, signal?: AbortSignal): Promise<OwnerHappyHorseEditVideoUploadReceipt> {
    this.#assertOpen(); const q = snapshotInput(input); let validated: Readonly<ValidatedOwnerHappyHorseEditVideo> | undefined;
    let invoked = false, semantic = "";
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: q.attempt, linkService: this.#links });
      const client = clientSnapshot(this.#resolveClient(q.attempt));
      validated = await this.#validate.validate({ filename: q.filename, mime_type: q.mime, bytes: q.bytes }, signal);
      const read = readValidatedOwnerHappyHorseEditVideo(validated); if (!read) fail("VALIDATION_REJECTED");
      semantic = `${principal.tenant_id}:${principal.subject_id}:${read.sha256}:${read.size}`; read.bytes.fill(0);
      if (this.#unknown.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const epoch = this.#epochs.get(q.attempt) ?? 0, expires = this.#time() + TTL;
      invoked = true;
      let context: OwnerHappyHorseEditVideoUploadContext;
      try { context = await Reflect.apply(NATIVE_UPLOAD as Function, client, [{ media: validated, destination: this.#destination }, signal]) as OwnerHappyHorseEditVideoUploadContext; }
      catch { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const native = readOwnerHappyHorseEditVideoReference(client, context);
      if (!native || native.type !== "video" || !isSafeUploadReferenceUrl(native.url) || context.model_id !== "happy_horse_edit" ||
          context.destination !== this.#destination || context.sha256 !== read.sha256 || context.size !== read.size || context.mime_type !== read.mime_type ||
          context.width !== read.width || context.height !== read.height || context.measured_duration_seconds !== read.measured_duration_seconds) fail("UPLOAD_OUTCOME_UNKNOWN");
      const after = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: q.attempt, linkService: this.#links });
      if (!sameGenerationPrincipal(principal, after) || clientSnapshot(this.#resolveClient(q.attempt)) !== client || (this.#epochs.get(q.attempt) ?? 0) !== epoch) fail("UPLOAD_OUTCOME_UNKNOWN");
      const now = this.#time(); if (expires - now < 1_000) fail("UPLOAD_OUTCOME_UNKNOWN");
      const handle = `happy_horse_video_${randomUUID()}`, entry = Object.freeze({ handle, attempt: q.attempt, principal, client, context, expiresAt: expires, epoch });
      this.#entries.set(handle, entry);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: "happy_horse_edit", media_type: "video", mime_type: read.mime_type,
        size: read.size, sha256: read.sha256, width: read.width, height: read.height, measured_duration_seconds: read.measured_duration_seconds,
        expires_in_seconds: Math.floor((expires - now) / 1000), probe_confidence: read.probe_confidence,
        local_limit_confidence: read.local_limit_confidence, provider_acceptance: "UNPROVEN", generation_permit: false });
    } catch (error) { if (invoked) this.#unknown.add(semantic);
      if (error instanceof OwnerHappyHorseEditVideoReferenceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("VALIDATION_REJECTED");
    } finally { if (validated) releaseValidatedOwnerHappyHorseEditVideo(validated); q.bytes.fill(0); }
  }
  async resolveVideo(input: unknown, signal?: AbortSignal): Promise<OwnerHappyHorseOwnedVideo> {
    this.#assertOpen(); const f = exact(input, ["attemptId", "reference_handle"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.reference_handle !== "string" || !HANDLE.test(f.reference_handle)) fail("INVALID_REQUEST");
    if (signal?.aborted) fail("INVALID_REQUEST");
    const attempt = f.attemptId, principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links });
    const entry = this.#entries.get(f.reference_handle); if (!entry || entry.attempt !== attempt || !sameGenerationPrincipal(entry.principal, principal)) fail("REFERENCE_UNAVAILABLE");
    const now = this.#time(); if (entry.expiresAt <= now) { this.#entries.delete(entry.handle); fail("REFERENCE_EXPIRED"); }
    if (clientSnapshot(this.#resolveClient(attempt)) !== entry.client || entry.epoch !== (this.#epochs.get(attempt) ?? 0)) fail("REFERENCE_UNAVAILABLE");
    const ref = readOwnerHappyHorseEditVideoReference(entry.client, entry.context); if (!ref || !isSafeUploadReferenceUrl(ref.url)) fail("REFERENCE_UNAVAILABLE");
    const latest = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links });
    if (!sameGenerationPrincipal(principal, latest) || entry.expiresAt <= this.#time()) fail("REFERENCE_EXPIRED");
    const c = entry.context, owned = Object.freeze({ attempt_id: attempt, model_id: "happy_horse_edit" as const,
      principal, profile_sha256: getOwnerHappyHorseSourceProfile().source_sha256, expires_at: entry.expiresAt, generation_permit: false as const,
      video: Object.freeze({ reference_handle: entry.handle, mime_type: c.mime_type, size: c.size, sha256: c.sha256, width: c.width,
        height: c.height, measured_duration_seconds: c.measured_duration_seconds }) });
    OWNED.set(owned, Object.freeze({ service: this, entry, client: entry.client })); return owned;
  }
  withCapturedVideo<T>(owned: unknown, consume: (client: SyntxChatHttpClient, video: OwnerHappyHorseVideoUploadReference) => T): T {
    if (!this.isOwnedVideo(owned)) fail("REFERENCE_UNAVAILABLE"); const state = OWNED.get(owned as object)!;
    const ref = readOwnerHappyHorseEditVideoReference(state.client, state.entry.context); if (!ref) fail("REFERENCE_UNAVAILABLE"); return consume(state.client, ref);
  }
  isOwnedVideo(value: unknown): value is OwnerHappyHorseOwnedVideo {
    try { if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const s = OWNED.get(value); return !!s && s.service === this && this.#entries.get(s.entry.handle) === s.entry && s.entry.expiresAt > this.#time() &&
        s.entry.epoch === (this.#epochs.get(s.entry.attempt) ?? 0) && readOwnerHappyHorseEditVideoReference(s.client, s.entry.context) !== null;
    } catch { return false; }
  }
  async invalidateAttempt(attempt: string): Promise<void> { if (!ATTEMPT.test(attempt)) return; this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const [handle, entry] of this.#entries) if (entry.attempt === attempt) this.#entries.delete(handle); }
  async close(): Promise<void> { this.#closed = true; this.#entries.clear(); this.#unknown.clear(); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number { const n = this.#now(); if (!Number.isSafeInteger(n) || n < this.#lastTime) fail("INVALID_REQUEST"); this.#lastTime = n; return n; }
}
export function isOwnerHappyHorseEditVideoReferenceService(value: unknown): value is OwnerHappyHorseEditVideoReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerHappyHorseEditVideoReferenceService.prototype && Object.isFrozen(value);
}
function snapshotInput(input: unknown): Readonly<{ attempt: string; filename: string; mime: OwnerHappyHorseEditVideoMimeType; bytes: Buffer }> {
  const f = exact(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.filename !== "string" ||
      (f.mime_type !== "video/mp4" && f.mime_type !== "video/quicktime") || !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes)) fail("INVALID_REQUEST");
  return Object.freeze({ attempt: f.attemptId, filename: f.filename, mime: f.mime_type, bytes: copyBytes(f.bytes) });
}
function copyBytes(value: Uint8Array): Buffer {
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
        ["buffer", "byteOffset", "byteLength", "length"].some(key => Object.hasOwn(value, key))) fail("INVALID_REQUEST");
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
    const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
    const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, buffer, []) as number;
    if (types.isProxy(buffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > 100 * 1024 * 1024 || offset + length > backingLength) fail("INVALID_REQUEST");
    const view = new Uint8Array(buffer, offset, length), copy = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index++) copy[index] = view[index]!;
    return copy;
  } catch { return fail("INVALID_REQUEST"); }
}
function clientSnapshot(value: unknown): SyntxChatHttpClient { if (!value || typeof value !== "object" || types.isProxy(value) ||
    Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Reflect.get(value, "uploadOwnerHappyHorseEditVideo") !== NATIVE_UPLOAD) fail("INVALID_REQUEST"); return value as SyntxChatHttpClient; }
function genuineLinks(value: unknown): value is Pick<PerUserLinkService, "getStatus"> { try { return !!value && typeof value === "object" && !types.isProxy(value) &&
  Object.getPrototypeOf(value) === PerUserLinkService.prototype && Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; } }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const p = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(d);
    if ((p !== Object.prototype && p !== null) || own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) fail("INVALID_REQUEST");
    const out = Object.create(null) as Record<string, unknown>; for (const k of keys) out[k] = d[k]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); } }
function fail(code: OwnerHappyHorseEditVideoReferenceError["code"]): never { throw new OwnerHappyHorseEditVideoReferenceError(code); }
