import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import {
  SyntxChatHttpClient,
  readOwnerWan26I2vUploadReferenceForClient
} from "../adapter/syntx/chat-http-client.js";
import type {
  OwnerWan26I2vAudioUploadContext,
  OwnerWan26I2vImageUploadContext,
  OwnerWan26I2vUploadContext
} from "../adapter/syntx/wan26-i2v-upload-context.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import {
  isValidatedOwnerWan26I2vImage,
  releaseValidatedOwnerWan26I2vImage,
  validateOwnerWan26I2vImage,
  OwnerWan26I2vImagePolicyError,
  type ValidatedOwnerWan26I2vImage,
  type OwnerWan26I2vModelId
} from "./owner-wan26-i2v-image-policy.js";
import {
  copyTrustedOwnerWan26I2vAudioBytes,
  createOwnerWan26I2vAudioProbe,
  isTrustedOwnerWan26I2vAudioProbeResult,
  releaseTrustedOwnerWan26I2vAudioProbeResult,
  OwnerWan26I2vAudioProbeError,
  type OwnerWan26I2vAudioProbeResult
} from "./owner-wan26-i2v-audio-probe.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^wan26image_[0-9a-f-]{36}$/u;
const AUDIO_HANDLE = /^wan26audio_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS_AND_CLAIMS = 128;
const MAX_PENDING = 4;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;
const NATIVE_IMAGE_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vImage;
const NATIVE_AUDIO_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vAudio;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const NATIVE_READER = readOwnerWan26I2vUploadReferenceForClient;
const RESOLUTIONS = new WeakMap<object, ResolutionState>();

export const OWNER_WAN26_I2V_REFERENCE_LIMITS = Object.freeze({
  max_records_and_semantic_claims: MAX_RECORDS_AND_CLAIMS,
  max_pending_operations: MAX_PENDING,
  expires_in_seconds: 900,
  image_max_base64_chars: MAX_BASE64_CHARS,
  audio_max_base64_chars: MAX_BASE64_CHARS
});

export interface OwnerWan26I2vReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly ffprobePath: string;
  readonly now?: () => number;
}
export interface OwnerWan26I2vUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerWan26I2vModelId;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}
export interface OwnerWan26I2vImageUploadReceipt {
  readonly status: "uploaded";
  readonly model_id: OwnerWan26I2vModelId;
  readonly image_handle: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: 900;
  readonly generation_permit: false;
}
export interface OwnerWan26I2vAudioUploadReceipt {
  readonly status: "uploaded";
  readonly model_id: OwnerWan26I2vModelId;
  readonly audio_handle: string;
  readonly filename: string;
  readonly mime_type: "audio/mpeg" | "audio/wav";
  readonly size: number;
  readonly sha256: string;
  readonly duration_seconds: number;
  readonly expires_in_seconds: 900;
  readonly generation_permit: false;
}
export interface OwnerWan26I2vReferenceResolveInput {
  readonly attempt_id: string;
  readonly model_id: OwnerWan26I2vModelId;
  readonly image_handle: string;
  readonly audio_handle: string | null;
}
export interface OwnerWan26I2vResolvedImage {
  readonly image_handle: string;
  readonly model_id: OwnerWan26I2vModelId;
  readonly filename: string;
  readonly mime_type: OwnerWan26I2vImageUploadContext["mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly generation_permit: false;
}
export interface OwnerWan26I2vResolvedAudio {
  readonly audio_handle: string;
  readonly model_id: OwnerWan26I2vModelId;
  readonly filename: string;
  readonly mime_type: OwnerWan26I2vAudioUploadContext["mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly duration_seconds: number;
  readonly generation_permit: false;
}
export interface OwnerWan26I2vReferenceResolution {
  readonly model_id: OwnerWan26I2vModelId;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly image: Readonly<OwnerWan26I2vResolvedImage>;
  readonly audio: Readonly<OwnerWan26I2vResolvedAudio> | null;
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}
export type OwnerWan26I2vNativeReferenceTuple =
  | readonly [OwnerWan26I2vImageUploadContext]
  | readonly [OwnerWan26I2vImageUploadContext, OwnerWan26I2vAudioUploadContext];
export type OwnerWan26I2vNativeReferenceConsumer<T> = (
  client: SyntxChatHttpClient,
  references: OwnerWan26I2vNativeReferenceTuple
) => T | Promise<T>;
export type OwnerWan26I2vReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" | "SERVICE_CLOSED"
  | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED" | "UPLOAD_REJECTED"
  | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerWan26I2vReferenceServiceError extends Error {
  constructor(readonly code: OwnerWan26I2vReferenceServiceErrorCode) {
    super("The owner WAN 2.6 I2V reference could not be established safely.");
    this.name = "OwnerWan26I2vReferenceServiceError";
  }
}

interface Operation {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly remove: () => void;
  readonly epoch: number;
}
interface BaseRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly modelId: OwnerWan26I2vModelId;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly context: OwnerWan26I2vUploadContext;
  readonly receipt: OwnerWan26I2vImageUploadReceipt | OwnerWan26I2vAudioUploadReceipt;
  readonly semanticKey: string;
  readonly expiresAt: number;
  readonly epoch: number;
}
interface ImageRecord extends BaseRecord {
  readonly kind: "image";
  readonly context: OwnerWan26I2vImageUploadContext;
  readonly receipt: OwnerWan26I2vImageUploadReceipt;
}
interface AudioRecord extends BaseRecord {
  readonly kind: "audio";
  readonly context: OwnerWan26I2vAudioUploadContext;
  readonly receipt: OwnerWan26I2vAudioUploadReceipt;
}
type MediaRecord = ImageRecord | AudioRecord;
interface ResolutionState {
  readonly service: OwnerWan26I2vReferenceService;
  readonly image: ImageRecord;
  readonly audio?: AudioRecord;
  readonly input: Readonly<OwnerWan26I2vReferenceResolveInput>;
}

/** Owner-bound, process-local WAN 2.6 I2V upload handles; this grants no generation authority. */
export class OwnerWan26I2vReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #probe: ReturnType<typeof createOwnerWan26I2vAudioProbe>;
  readonly #now: () => number;
  readonly #records = new Map<string, MediaRecord>();
  readonly #known = new Map<string, string>();
  readonly #byAttempt = new Map<string, Set<string>>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<Operation>>();
  readonly #operations = new Set<Promise<void>>();
  readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerWan26I2vReferenceServiceOptions | unknown) {
    const f = exactRecord(options, ["binding", "linkService", "resolveClient", "ffprobePath"], ["now"]);
    if (!isLinkService(f.linkService) || typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) ||
        typeof f.ffprobePath !== "string" || !isAbsolute(f.ffprobePath) || f.ffprobePath.includes("\0") ||
        (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding);
    this.#links = f.linkService;
    this.#resolveClient = f.resolveClient as (attemptId: string) => unknown;
    this.#probe = createOwnerWan26I2vAudioProbe({ ffprobePath: f.ffprobePath });
    this.#now = f.now === undefined ? () => performance.now() : readClock(f.now);
    Object.freeze(this);
  }

  async uploadImage(input: OwnerWan26I2vUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan26I2vImageUploadReceipt> {
    this.#assertOpen();
    const request = uploadInput(input); const op = this.#begin(request.attemptId, signal);
    let receipt: Readonly<ValidatedOwnerWan26I2vImage> | undefined;
    let semanticKey: string | undefined; let claimed = false; let posted = false; let unknown = false;
    try {
      const bytes = decodeBase64(request.content_base64);
      try {
        receipt = validateOwnerWan26I2vImage({ model_id: request.model_id, filename: request.filename, mime_type: request.mime_type, bytes });
        if (!isValidatedOwnerWan26I2vImage(receipt)) fail("INVALID_REQUEST");
      }
      catch { fail("INVALID_REQUEST"); }
      finally { bytes.fill(0); }
      this.#stopped(op);
      const principal = await this.#principal(request.attemptId, op.controller.signal); this.#stopped(op);
      this.#remember(request.attemptId, principal, op);
      const client = await this.#client(request.attemptId, op); this.#stopped(op);
      semanticKey = semantic(principal, request.attemptId, request.model_id, "image", receipt.sha256, receipt.mime_type, receipt.filename);
      const prior = this.#existing<ImageRecord>(semanticKey, "image", request.model_id, principal, client);
      if (prior) {
        await this.#assertAttempt(request.attemptId, principal, client, op);
        if (!this.#live(prior)) fail("REFERENCE_EXPIRED");
        return prior.receipt;
      }
      this.#claim(semanticKey); claimed = true;
      await this.#assertAttempt(request.attemptId, principal, client, op);
      posted = true;
      const context = await Reflect.apply(NATIVE_IMAGE_UPLOAD, client, [receipt, op.controller.signal]) as OwnerWan26I2vImageUploadContext;
      this.#stopped(op);
      if (!validImageContext(client, context, receipt)) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      await this.#assertAttempt(request.attemptId, principal, client, op, true);
      const createdAt = this.#time();
      if (createdAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const handle = `wan26image_${randomUUID()}`;
      const safe: OwnerWan26I2vImageUploadReceipt = Object.freeze({ status: "uploaded", model_id: request.model_id,
        image_handle: handle, filename: receipt.filename, mime_type: context.mime_type, size: context.size,
        sha256: context.sha256, width: context.width, height: context.height, expires_in_seconds: 900, generation_permit: false });
      this.#store(Object.freeze({ kind: "image", handle, attemptId: request.attemptId, modelId: request.model_id, principal, client,
        context, receipt: safe, semanticKey, expiresAt: createdAt + TTL_MS, epoch: op.epoch }));
      return safe;
    } catch (error) {
      if (posted && !isKnownRejection(error)) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      throw this.#mapError(error);
    } finally {
      if (receipt) releaseValidatedOwnerWan26I2vImage(receipt);
      if (semanticKey && claimed) this.#pendingSemantics.delete(semanticKey);
      if (semanticKey && unknown) this.#unknownSemantics.add(semanticKey);
      this.#finish(op);
    }
  }

  async uploadAudio(input: OwnerWan26I2vUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan26I2vAudioUploadReceipt> {
    this.#assertOpen();
    const request = uploadInput(input); const op = this.#begin(request.attemptId, signal);
    let probe: Readonly<OwnerWan26I2vAudioProbeResult> | undefined;
    let semanticKey: string | undefined; let claimed = false; let posted = false; let unknown = false;
    try {
      const bytes = decodeBase64(request.content_base64);
      try { probe = await this.#probe.probe({ model_id: request.model_id, filename: request.filename,
        mime_type: request.mime_type, bytes }, { signal: op.controller.signal }); }
      finally { bytes.fill(0); }
      this.#stopped(op);
      if (!isTrustedOwnerWan26I2vAudioProbeResult(probe)) fail("INVALID_REQUEST");
      const ownedBytes = copyTrustedOwnerWan26I2vAudioBytes(probe);
      try {
        if (ownedBytes.byteLength !== probe.bytes_copied || createSha256(ownedBytes) !== probe.source_sha256) fail("INVALID_REQUEST");
      } finally { ownedBytes.fill(0); }
      const principal = await this.#principal(request.attemptId, op.controller.signal); this.#stopped(op);
      this.#remember(request.attemptId, principal, op);
      const client = await this.#client(request.attemptId, op); this.#stopped(op);
      semanticKey = semantic(principal, request.attemptId, request.model_id, "audio", probe.source_sha256, probe.mime_type, probe.filename);
      const prior = this.#existing<AudioRecord>(semanticKey, "audio", request.model_id, principal, client);
      if (prior) {
        await this.#assertAttempt(request.attemptId, principal, client, op);
        if (!this.#live(prior)) fail("REFERENCE_EXPIRED");
        return prior.receipt;
      }
      this.#claim(semanticKey); claimed = true;
      await this.#assertAttempt(request.attemptId, principal, client, op);
      posted = true;
      const context = await Reflect.apply(NATIVE_AUDIO_UPLOAD, client, [probe, op.controller.signal]) as OwnerWan26I2vAudioUploadContext;
      this.#stopped(op);
      if (!validAudioContext(client, context, probe)) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      await this.#assertAttempt(request.attemptId, principal, client, op, true);
      const createdAt = this.#time();
      if (createdAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const handle = `wan26audio_${randomUUID()}`;
      const safe: OwnerWan26I2vAudioUploadReceipt = Object.freeze({ status: "uploaded", model_id: request.model_id,
        audio_handle: handle, filename: probe.filename, mime_type: context.mime_type, size: context.size,
        sha256: context.sha256, duration_seconds: context.measured_duration_seconds, expires_in_seconds: 900, generation_permit: false });
      this.#store(Object.freeze({ kind: "audio", handle, attemptId: request.attemptId, modelId: request.model_id, principal, client,
        context, receipt: safe, semanticKey, expiresAt: createdAt + TTL_MS, epoch: op.epoch }));
      return safe;
    } catch (error) {
      if (posted && !isKnownRejection(error)) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      throw this.#mapError(error);
    } finally {
      if (probe) releaseTrustedOwnerWan26I2vAudioProbeResult(probe);
      if (semanticKey && claimed) this.#pendingSemantics.delete(semanticKey);
      if (semanticKey && unknown) this.#unknownSemantics.add(semanticKey);
      this.#finish(op);
    }
  }

  async resolveReferences(input: OwnerWan26I2vReferenceResolveInput | unknown, signal?: AbortSignal): Promise<OwnerWan26I2vReferenceResolution> {
    this.#assertOpen();
    const request = resolveInput(input); const op = this.#begin(request.attempt_id, signal);
    try {
      const principal = await this.#principal(request.attempt_id, op.controller.signal); this.#stopped(op);
      this.#remember(request.attempt_id, principal, op);
      const imageCandidate = this.#records.get(request.image_handle);
      if (!imageCandidate || imageCandidate.kind !== "image" || imageCandidate.attemptId !== request.attempt_id ||
          imageCandidate.modelId !== request.model_id) fail("REFERENCE_UNAVAILABLE");
      const image = imageCandidate as ImageRecord;
      let audio: AudioRecord | undefined;
      if (request.audio_handle !== null) {
        const audioCandidate = this.#records.get(request.audio_handle);
        if (!audioCandidate || audioCandidate.kind !== "audio" || audioCandidate.attemptId !== request.attempt_id ||
            audioCandidate.modelId !== request.model_id) fail("REFERENCE_UNAVAILABLE");
        audio = audioCandidate as AudioRecord;
      }
      const records = audio ? [image, audio] as const : [image] as const;
      await this.#verifyRecords(request.attempt_id, principal, records, op);
      const expiresAt = audio ? Math.min(image.expiresAt, audio.expiresAt) : image.expiresAt;
      const resolution: OwnerWan26I2vReferenceResolution = Object.freeze({ model_id: request.model_id, principal,
        attempt_id: request.attempt_id, image: safeImage(image), audio: audio ? safeAudio(audio) : null,
        expires_at: expiresAt, epoch: op.epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, Object.freeze({ service: this, image, ...(audio ? { audio } : {}), input: request }));
      return resolution;
    } catch (error) { throw this.#mapError(error); }
    finally { this.#finish(op); }
  }

  isOwnedReferenceResolution(value: unknown, input: OwnerWan26I2vReferenceResolveInput | unknown): boolean {
    try {
      const request = resolveInput(input);
      if (!isObject(value)) return false;
      const state = RESOLUTIONS.get(value);
      return !!state && state.service === this && sameResolveInput(state.input, request) && this.#resolutionLive(state);
    } catch { return false; }
  }

  async withCapturedNativeReferences<T>(
    value: unknown,
    input: OwnerWan26I2vReferenceResolveInput | unknown,
    consume: OwnerWan26I2vNativeReferenceConsumer<T>,
    signal?: AbortSignal
  ): Promise<T> {
    this.#assertOpen();
    const request = resolveInput(input);
    if (typeof consume !== "function" || types.isProxy(consume) || !isObject(value)) fail("INVALID_REQUEST");
    const state = RESOLUTIONS.get(value);
    if (!state || state.service !== this || !sameResolveInput(state.input, request)) fail("REFERENCE_UNAVAILABLE");
    const op = this.#begin(request.attempt_id, signal);
    try {
      const records = state.audio ? [state.image, state.audio] as const : [state.image] as const;
      await this.#verifyRecords(request.attempt_id, state.image.principal, records, op);
      if (!this.#resolutionLive(state)) fail("REFERENCE_EXPIRED");
      const tuple: OwnerWan26I2vNativeReferenceTuple = state.audio
        ? Object.freeze([state.image.context, state.audio.context]) as readonly [OwnerWan26I2vImageUploadContext, OwnerWan26I2vAudioUploadContext]
        : Object.freeze([state.image.context]) as readonly [OwnerWan26I2vImageUploadContext];
      const result = await consume(state.image.client, tuple);
      await this.#verifyRecords(request.attempt_id, state.image.principal, records, op);
      if (!this.#resolutionLive(state)) fail("REFERENCE_EXPIRED");
      return result;
    } catch (error) { throw this.#mapError(error); }
    finally { this.#finish(op); }
  }

  invalidateAttempt(value: unknown): Promise<void> {
    if (typeof value !== "string" || !ATTEMPT.test(value)) return Promise.resolve();
    const prior = this.#invalidations.get(value); if (prior) return prior;
    this.#revokeAttempt(value);
    return this.#invalidations.get(value) ?? Promise.resolve();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = new Set([...this.#byAttempt.keys(), ...this.#pendingByAttempt.keys(), ...this.#principals.keys()]);
    const invalidations = [...attempts].map((attemptId) => this.invalidateAttempt(attemptId));
    const operations = [...this.#operations];
    this.#closing = Promise.allSettled([...invalidations, ...operations]).then(() => {
      this.#records.clear(); this.#known.clear(); this.#byAttempt.clear(); this.#principals.clear(); this.#clients.clear();
      this.#epochs.clear(); this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear();
    });
    return this.#closing;
  }

  #begin(attemptId: string, parent?: AbortSignal): Operation {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    this.#prune(this.#time());
    const active = new Set([...this.#byAttempt.keys(), ...this.#principals.keys(), ...this.#pendingByAttempt.keys()]);
    if (!active.has(attemptId) && active.size >= MAX_RECORDS_AND_CLAIMS) fail("CAPACITY_EXCEEDED");
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(); const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<Operation>();
    const operation: Operation = { attemptId, controller, done, finish, remove: () => parent?.removeEventListener("abort", abort),
      epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#operations.add(done); this.#pendingCount++;
    return operation;
  }

  #finish(operation: Operation): void {
    operation.remove(); const pending = this.#pendingByAttempt.get(operation.attemptId);
    pending?.delete(operation); if (!pending?.size) this.#pendingByAttempt.delete(operation.attemptId);
    this.#pendingCount--; operation.finish(); this.#operations.delete(operation.done); this.#maybeRelease(operation.attemptId);
  }

  #stopped(operation: Operation): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted || (this.#epochs.get(operation.attemptId) ?? 0) !== operation.epoch) fail("REQUEST_ABORTED");
  }

  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const lookup = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
    if (!signal) return lookup;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerWan26I2vReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([lookup, aborted]).finally(remove);
  }

  async #client(attemptId: string, operation?: Operation): Promise<SyntxChatHttpClient> {
    let value: unknown;
    try { value = await this.#resolveClient(attemptId); } catch { fail("PROFILE_BINDING_MISMATCH"); }
    const client = exactNativeClient(value);
    const prior = this.#clients.get(attemptId);
    if (prior && prior !== client) { this.#revokeAttempt(attemptId, operation); fail("PROFILE_BINDING_MISMATCH"); }
    this.#clients.set(attemptId, client); return client;
  }

  #remember(attemptId: string, principal: Readonly<GenerationPrincipalRef>, operation: Operation): void {
    const old = this.#principals.get(attemptId);
    if (old && !sameGenerationPrincipal(old, principal)) { this.#revokeAttempt(attemptId, operation); fail("PRINCIPAL_NOT_LINKED"); }
    this.#principals.set(attemptId, principal);
  }

  async #assertAttempt(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    operation: Operation, unknownAfterPost = false): Promise<void> {
    this.#stopped(operation);
    if (this.#clients.get(attemptId) !== client || !sameGenerationPrincipal(this.#principals.get(attemptId) ?? principal, principal)) {
      if (unknownAfterPost) { this.#revokeAttempt(attemptId, operation); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      fail("PRINCIPAL_NOT_LINKED");
    }
    let current: Readonly<GenerationPrincipalRef>;
    try { current = await this.#principal(attemptId, operation.controller.signal); }
    catch (error) { if (unknownAfterPost) { this.#revokeAttempt(attemptId, operation); fail("UPLOAD_OUTCOME_UNKNOWN"); } throw error; }
    this.#stopped(operation);
    const currentClient = await this.#client(attemptId, operation); this.#stopped(operation);
    if (!sameGenerationPrincipal(principal, current) || currentClient !== client) {
      if (unknownAfterPost) { this.#revokeAttempt(attemptId, operation); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#revokeAttempt(attemptId, operation); fail("PRINCIPAL_NOT_LINKED");
    }
  }

  async #verifyRecords(attemptId: string, principal: Readonly<GenerationPrincipalRef>, records: readonly MediaRecord[], operation: Operation): Promise<void> {
    this.#stopped(operation);
    if (!records.length || records.some((record) => !this.#live(record) || record.attemptId !== attemptId ||
        !sameGenerationPrincipal(record.principal, principal) || !contextMatchesRecord(record))) fail("REFERENCE_EXPIRED");
    const client = await this.#client(attemptId, operation); this.#stopped(operation);
    if (records.some((record) => record.client !== client || !NATIVE_READER(client, record.context))) fail("REFERENCE_UNAVAILABLE");
    const current = await this.#principal(attemptId, operation.controller.signal); this.#stopped(operation);
    const currentClient = await this.#client(attemptId, operation); this.#stopped(operation);
    if (!sameGenerationPrincipal(principal, current) || currentClient !== client) { this.#revokeAttempt(attemptId, operation); fail("PRINCIPAL_NOT_LINKED"); }
    if (records.some((record) => !this.#live(record) || !NATIVE_READER(client, record.context))) fail("REFERENCE_EXPIRED");
  }

  #resolutionLive(state: ResolutionState): boolean {
    return state.service === this && this.#live(state.image) && (!state.audio || this.#live(state.audio)) &&
      (this.#clients.get(state.image.attemptId) === state.image.client) &&
      sameGenerationPrincipal(this.#principals.get(state.image.attemptId) ?? state.image.principal, state.image.principal) &&
      NATIVE_READER(state.image.client, state.image.context) !== null &&
      (!state.audio || NATIVE_READER(state.audio.client, state.audio.context) !== null);
  }

  #existing<T extends MediaRecord>(key: string, kind: T["kind"], modelId: OwnerWan26I2vModelId,
    principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient): T | undefined {
    if (this.#unknownSemantics.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN");
    if (this.#pendingSemantics.has(key)) fail("SERVICE_BUSY");
    const record = this.#records.get(this.#known.get(key) ?? "");
    if (record && record.kind === kind && record.modelId === modelId && record.client === client &&
        sameGenerationPrincipal(record.principal, principal) && this.#live(record)) return record as T;
    if (record) this.#remove(record.handle);
    return undefined;
  }

  #claim(key: string): void {
    if (this.#unknownSemantics.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN");
    if (this.#pendingSemantics.has(key)) fail("SERVICE_BUSY");
    this.#prune(this.#time());
    if (this.#records.size + this.#pendingSemantics.size + this.#unknownSemantics.size >= MAX_RECORDS_AND_CLAIMS) fail("CAPACITY_EXCEEDED");
    this.#pendingSemantics.add(key);
  }

  #store(record: MediaRecord): void {
    this.#records.set(record.handle, record); this.#known.set(record.semanticKey, record.handle);
    const handles = this.#byAttempt.get(record.attemptId) ?? new Set<string>(); handles.add(record.handle); this.#byAttempt.set(record.attemptId, handles);
  }

  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#remove(handle);
    const active = new Set([...this.#byAttempt.keys(), ...this.#pendingByAttempt.keys(), ...this.#principals.keys()]);
    for (const attemptId of this.#epochs.keys()) if (!active.has(attemptId)) this.#epochs.delete(attemptId);
  }

  #live(record: MediaRecord): boolean {
    return !this.#closed && !this.#invalidating.has(record.attemptId) && this.#records.get(record.handle) === record &&
      record.expiresAt > this.#time() && record.epoch === (this.#epochs.get(record.attemptId) ?? 0);
  }

  #remove(handle: string): void {
    const record = this.#records.get(handle); if (!record) return;
    this.#records.delete(handle); this.#known.delete(record.semanticKey);
    const handles = this.#byAttempt.get(record.attemptId); handles?.delete(handle); if (!handles?.size) this.#byAttempt.delete(record.attemptId);
    this.#maybeRelease(record.attemptId);
  }

  #revokeAttempt(attemptId: string, exclude?: Operation): void {
    if (!this.#invalidating.has(attemptId)) this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#invalidating.add(attemptId);
    for (const handle of this.#byAttempt.get(attemptId) ?? []) this.#remove(handle);
    this.#byAttempt.delete(attemptId); this.#principals.delete(attemptId); this.#clients.delete(attemptId);
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<Operation>();
    for (const operation of pending) if (operation !== exclude) operation.controller.abort();
    if (!this.#invalidations.has(attemptId)) {
      const done = Promise.allSettled([...pending].map((operation) => operation.done)).then(() => {
        this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId);
      });
      this.#invalidations.set(attemptId, done);
    }
  }

  #maybeRelease(attemptId: string): void {
    if (this.#byAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principals.delete(attemptId); this.#clients.delete(attemptId);
  }

  #time(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
        (this.#lastNow !== undefined && value < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value; return value;
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #mapError(error: unknown): OwnerWan26I2vReferenceServiceError {
    if (error instanceof OwnerWan26I2vReferenceServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan26I2vReferenceServiceError("PRINCIPAL_NOT_LINKED");
    if (error instanceof OwnerWan26I2vAudioProbeError) return new OwnerWan26I2vReferenceServiceError(error.code === "PROBE_ABORTED" ? "REQUEST_ABORTED" : "INVALID_REQUEST");
    if (error instanceof OwnerWan26I2vImagePolicyError) return new OwnerWan26I2vReferenceServiceError("INVALID_REQUEST");
    if (error instanceof SyntxHttpError && isKnownRejection(error)) return new OwnerWan26I2vReferenceServiceError("UPLOAD_REJECTED");
    return new OwnerWan26I2vReferenceServiceError("REFERENCE_UNAVAILABLE");
  }
}

function isKnownRejection(error: unknown): boolean {
  return error instanceof SyntxHttpError && ["INVALID_REQUEST", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED"].includes(error.code);
}
function validImageContext(client: SyntxChatHttpClient, value: unknown, source: Readonly<ValidatedOwnerWan26I2vImage>): value is OwnerWan26I2vImageUploadContext {
  if (!isObject(value) || !Object.isFrozen(value) || !NATIVE_READER(client, value)) return false;
  const context = value as OwnerWan26I2vImageUploadContext;
  return context.status === "uploaded" && context.model_id === source.model_id && context.media_type === "image" &&
    context.mime_type === source.mime_type && context.size === source.size && context.sha256 === source.sha256 &&
    context.width === source.width && context.height === source.height;
}
function validAudioContext(client: SyntxChatHttpClient, value: unknown, source: Readonly<OwnerWan26I2vAudioProbeResult>): value is OwnerWan26I2vAudioUploadContext {
  if (!isObject(value) || !Object.isFrozen(value) || !NATIVE_READER(client, value)) return false;
  const context = value as OwnerWan26I2vAudioUploadContext;
  return context.status === "uploaded" && context.model_id === source.model_id && context.media_type === "audio" &&
    context.mime_type === source.mime_type && context.size === source.bytes_copied && context.sha256 === source.source_sha256 &&
    context.measured_duration_seconds === source.metadata.duration_seconds;
}
function contextMatchesRecord(record: MediaRecord): boolean {
  return record.kind === "image" ? validImageMetadata(record) : validAudioMetadata(record);
}
function validImageMetadata(record: ImageRecord): boolean {
  return record.context.model_id === record.modelId && record.context.media_type === "image" &&
    record.context.mime_type === record.receipt.mime_type && record.context.size === record.receipt.size &&
    record.context.sha256 === record.receipt.sha256 && record.context.width === record.receipt.width && record.context.height === record.receipt.height;
}
function validAudioMetadata(record: AudioRecord): boolean {
  return record.context.model_id === record.modelId && record.context.media_type === "audio" &&
    record.context.mime_type === record.receipt.mime_type && record.context.size === record.receipt.size &&
    record.context.sha256 === record.receipt.sha256 && record.context.measured_duration_seconds === record.receipt.duration_seconds;
}
function safeImage(record: ImageRecord): Readonly<OwnerWan26I2vResolvedImage> {
  return Object.freeze({ image_handle: record.handle, model_id: record.modelId, filename: record.receipt.filename,
    mime_type: record.context.mime_type, size: record.receipt.size, sha256: record.receipt.sha256,
    width: record.receipt.width, height: record.receipt.height, generation_permit: false });
}
function safeAudio(record: AudioRecord): Readonly<OwnerWan26I2vResolvedAudio> {
  return Object.freeze({ audio_handle: record.handle, model_id: record.modelId, filename: record.receipt.filename,
    mime_type: record.receipt.mime_type, size: record.receipt.size, sha256: record.receipt.sha256,
    duration_seconds: record.receipt.duration_seconds, generation_permit: false });
}
function semantic(principal: Readonly<GenerationPrincipalRef>, attemptId: string, modelId: OwnerWan26I2vModelId,
  kind: MediaRecord["kind"], hash: string, mime: string, filename: string): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, principal.connection_id, attemptId, modelId, kind, hash, mime, filename]);
}
function sameResolveInput(a: OwnerWan26I2vReferenceResolveInput, b: OwnerWan26I2vReferenceResolveInput): boolean {
  return a.attempt_id === b.attempt_id && a.model_id === b.model_id && a.image_handle === b.image_handle && a.audio_handle === b.audio_handle;
}
function decodeBase64(value: string): Buffer {
  if (!value || value.length > MAX_BASE64_CHARS || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail("INVALID_REQUEST");
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MEDIA_BYTES || bytes.toString("base64") !== value) { bytes.fill(0); fail("INVALID_REQUEST"); }
  return bytes;
}
function uploadInput(value: unknown): OwnerWan26I2vUploadInput {
  const f = exactRecord(value, ["attemptId", "model_id", "content_base64", "filename", "mime_type"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isModelId(f.model_id) ||
      typeof f.content_base64 !== "string" || typeof f.filename !== "string" || typeof f.mime_type !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, model_id: f.model_id, content_base64: f.content_base64, filename: f.filename, mime_type: f.mime_type });
}
function resolveInput(value: unknown): Readonly<OwnerWan26I2vReferenceResolveInput> {
  const f = exactRecord(value, ["attempt_id", "model_id", "image_handle", "audio_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || !isModelId(f.model_id) ||
      typeof f.image_handle !== "string" || !IMAGE_HANDLE.test(f.image_handle) ||
      (f.audio_handle !== null && (typeof f.audio_handle !== "string" || !AUDIO_HANDLE.test(f.audio_handle)))) fail("INVALID_REQUEST");
  return Object.freeze({ attempt_id: f.attempt_id, model_id: f.model_id, image_handle: f.image_handle, audio_handle: f.audio_handle as string | null });
}
function exactNativeClient(value: unknown): SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadWan26I2vImage") || Object.hasOwn(value, "uploadWan26I2vAudio") ||
        SyntxChatHttpClient.prototype.uploadWan26I2vImage !== NATIVE_IMAGE_UPLOAD ||
        SyntxChatHttpClient.prototype.uploadWan26I2vAudio !== NATIVE_AUDIO_UPLOAD ||
        Reflect.get(value, "uploadWan26I2vImage") !== NATIVE_IMAGE_UPLOAD || Reflect.get(value, "uploadWan26I2vAudio") !== NATIVE_AUDIO_UPLOAD) fail("PROFILE_BINDING_MISMATCH");
    return value as SyntxChatHttpClient;
  } catch { fail("PROFILE_BINDING_MISMATCH"); }
}
function isLinkService(value: unknown): value is PerUserLinkService {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
        PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
    const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS;
  } catch { return false; }
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const f = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || f.tenant_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(f.tenant_id) ||
      typeof f.subject !== "string" || !f.subject || f.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(f.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject });
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { try { return Reflect.apply(value, undefined, []) as number; } catch { fail("SERVICE_CLOSED"); } };
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isObject(value)) fail("INVALID_REQUEST");
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors); const allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function isObject(value: unknown): value is object { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function isModelId(value: unknown): value is OwnerWan26I2vModelId { return value === "wan_26_i2v" || value === "wan_26_i2v_flash"; }
function createSha256(value: Uint8Array): string {
  // The native image/audio proof already supplies the digest; this local check uses Node's built-in crypto.
  return createHash("sha256").update(value).digest("hex");
}
function fail(code: OwnerWan26I2vReferenceServiceErrorCode): never { throw new OwnerWan26I2vReferenceServiceError(code); }
