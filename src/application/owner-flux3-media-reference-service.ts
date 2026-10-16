import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import {
  SyntxChatHttpClient,
  readOwnerFlux3UploadReferenceForClient
} from "../adapter/syntx/chat-http-client.js";
import type {
  OwnerFlux3I2vImageUploadContext,
  OwnerFlux3UploadContext,
  OwnerFlux3UploadDestination,
  OwnerFlux3V2vOriginalUploadContext
} from "../adapter/syntx/flux3-media-upload.js";
import {
  isOwnerFlux3I2vImage,
  releaseOwnerFlux3I2vImage,
  validateOwnerFlux3I2vImage,
  OwnerFlux3I2vImageProbeError,
  type OwnerFlux3I2vImageProbeResult
} from "./owner-flux3-i2v-image-probe.js";
import {
  getOwnerFlux3VideoSourceProfile,
  OWNER_FLUX3_VIDEO_MODEL_IDS,
  OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
  type OwnerFlux3VideoModelId,
  type OwnerFlux3VideoSourceProfile
} from "./owner-flux3-video-source-profile.js";
import {
  isOwnerFlux3V2vOriginalProbe,
  probeOwnerFlux3V2vOriginal,
  releaseOwnerFlux3V2vOriginalProbe,
  OwnerFlux3V2vOriginalProbeError,
  type OwnerFlux3V2vOriginalProbeResult
} from "./owner-flux3-v2v-original-probe.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^flux3_media_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_I2V_UPLOAD = SyntxChatHttpClient.prototype.uploadFlux3I2vImage;
const NATIVE_V2V_UPLOAD = SyntxChatHttpClient.prototype.uploadFlux3V2vOriginal;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerFlux3MediaReferenceService; readonly record: ReferenceRecord }>();
const PROFILE_IDS: readonly OwnerFlux3VideoModelId[] = OWNER_FLUX3_VIDEO_MODEL_IDS;

export type OwnerFlux3InputConfidence =
  | "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED"
  | "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE";

export interface OwnerFlux3MediaReferenceServiceOptions {
  /** Trusted operator configuration; never supplied through a tool argument. */
  readonly ffprobePath: string;
  readonly destination: OwnerFlux3UploadDestination;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerFlux3MediaReferenceUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
}

export interface OwnerFlux3MediaReferenceUploadReceipt {
  readonly status: "uploaded";
  readonly flux3_reference_handle: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly mime_type: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number | null;
  readonly input_confidence: OwnerFlux3InputConfidence;
  readonly expires_in_seconds: number;
}

export interface OwnerFlux3MediaReferenceResolveInput {
  readonly attemptId: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly flux3_reference_handle: string;
}

export interface OwnerFlux3MediaReferenceResolution {
  readonly role: "flux3_media_reference";
  readonly wire_type: "image" | "video";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly ai_name: "flux3_video";
  readonly source_catalog_version: typeof OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION;
  readonly source_pins: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly profile_schema_hash: string;
  readonly flux3_reference_handle: string;
  readonly sha256: string;
  readonly mime_type: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number | null;
  readonly input_confidence: OwnerFlux3InputConfidence;
  readonly destination: OwnerFlux3UploadDestination;
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}

export type OwnerFlux3MediaReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "PROBE_REJECTED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerFlux3MediaReferenceServiceError extends Error {
  constructor(readonly code: OwnerFlux3MediaReferenceServiceErrorCode) {
    super("The owner Flux3 media reference is unavailable.");
    this.name = "OwnerFlux3MediaReferenceServiceError";
  }
}

type OwnedProbe = Readonly<OwnerFlux3I2vImageProbeResult> | Readonly<OwnerFlux3V2vOriginalProbeResult>;
type OwnedUploadContext = OwnerFlux3I2vImageUploadContext | OwnerFlux3V2vOriginalUploadContext;

interface ReferenceRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly modelId: OwnerFlux3VideoModelId;
  readonly wireType: "image" | "video";
  readonly sourcePins: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly profileHash: string;
  readonly sourceSha256: string;
  readonly size: number;
  readonly filename: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number | null;
  readonly inputConfidence: OwnerFlux3InputConfidence;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnedUploadContext;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

interface UploadSnapshot {
  readonly attemptId: string;
  readonly modelId: OwnerFlux3VideoModelId;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

interface ProbeFacts {
  readonly modelId: OwnerFlux3VideoModelId;
  readonly wireType: "image" | "video";
  readonly filename: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number | null;
  readonly confidence: OwnerFlux3InputConfidence;
  readonly sourcePins: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly profileHash: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;

/** Process-local, one-input-at-a-time Flux3 references. They do not authorize generation. */
export class OwnerFlux3MediaReferenceService {
  readonly #ffprobePath: string;
  readonly #destination: OwnerFlux3UploadDestination;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #now: () => number;
  readonly #profileHashes: Readonly<Record<OwnerFlux3VideoModelId, string>>;
  readonly #records = new Map<string, ReferenceRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerFlux3MediaReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["ffprobePath", "destination", "binding", "linkService", "resolveClient"], ["now"]);
    if (typeof fields.ffprobePath !== "string" || !fields.ffprobePath ||
        (fields.destination !== "uploaded" && fields.destination !== "hidden") ||
        !isGenuineLinkService(fields.linkService) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    const hashes: Partial<Record<OwnerFlux3VideoModelId, string>> = {};
    for (const modelId of PROFILE_IDS) {
      const profile = getOwnerFlux3VideoSourceProfile(modelId);
      if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.model_id !== modelId ||
          profile.ai_name !== "flux3_video" || profile.source_pins.public_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION ||
          profile.runtime_usable !== false || profile.dispatch_allowed !== false) fail("INVALID_REQUEST");
      hashes[modelId] = schemaHash(profile);
    }
    this.#ffprobePath = fields.ffprobePath;
    this.#destination = fields.destination;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#profileHashes = Object.freeze({ flux3_i2v: hashes.flux3_i2v!, flux3_v2v: hashes.flux3_v2v! });
    Object.freeze(this);
  }

  async uploadReference(input: OwnerFlux3MediaReferenceUploadInput | unknown, signalInput?: AbortSignal): Promise<OwnerFlux3MediaReferenceUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input);
    let parentSignal: AbortSignal | undefined;
    let operation: PendingOperation;
    try {
      parentSignal = exactSignal(signalInput);
      operation = this.#begin(request.attemptId, parentSignal);
    } catch (error) {
      request.bytes.fill(0);
      throw error;
    }

    let probe: OwnedProbe | undefined;
    let semanticKey: string | undefined;
    let ownsSemanticReservation = false;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = snapshotNativeClient(this.#resolveClient(request.attemptId));
      probe = await this.#probe(request, operation.controller.signal);
      this.#throwIfStopped(operation);
      const facts = this.#facts(probe);
      semanticKey = this.#semanticKey(principal, facts);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);
      ownsSemanticReservation = true;

      const beforeUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      const clientBeforeUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, beforeUpload) || clientBeforeUpload.client !== initialClient.client) fail("PRINCIPAL_NOT_LINKED");
      const currentProfile = getOwnerFlux3VideoSourceProfile(request.modelId);
      if (!currentProfile || schemaHash(currentProfile) !== this.#profileHashes[request.modelId]) fail("PROBE_REJECTED");
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      const nativeReference = await this.#invokeUpload(clientBeforeUpload.client, probe, operation.controller.signal);
      this.#throwIfStopped(operation);
      const witness = readOwnerFlux3UploadReferenceForClient(clientBeforeUpload.client, nativeReference);
      if (!witness || !this.#matchesProbe(witness, probe)) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }

      const afterUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal).catch(() => {
        unknownOutcome = true;
        fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      this.#throwIfStopped(operation);
      const clientAfterUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, afterUpload) || clientAfterUpload.client !== clientBeforeUpload.client ||
          !readOwnerFlux3UploadReferenceForClient(clientBeforeUpload.client, nativeReference)) {
        unknownOutcome = true;
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }

      const acknowledgedAt = this.#readNow();
      const expiresAt = issuedAt + TTL_MS;
      if (expiresAt - acknowledgedAt < 1_000 || operation.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || !this.#pendingSemantics.has(semanticKey)) {
        unknownOutcome = true;
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }

      const handle = `flux3_media_reference_${randomUUID()}`;
      const record: ReferenceRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        modelId: facts.modelId, wireType: facts.wireType, sourcePins: facts.sourcePins, profileHash: facts.profileHash,
        sourceSha256: facts.sha256, size: facts.size, filename: facts.filename, mimeType: facts.mimeType,
        width: facts.width, height: facts.height, durationSeconds: facts.durationSeconds,
        inputConfidence: facts.confidence, expiresAt, epoch: operation.epoch,
        client: clientBeforeUpload.client, nativeReference });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", flux3_reference_handle: handle, model_id: record.modelId,
        mime_type: record.mimeType, size: record.size, sha256: record.sourceSha256,
        width: record.width, height: record.height, duration_seconds: record.durationSeconds,
        input_confidence: record.inputConfidence, expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1_000) });
    } catch (error) {
      if (error instanceof OwnerFlux3MediaReferenceServiceError) {
        if (nativeInvoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") {
          unknownOutcome = true;
          fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome ||= nativeInvoked;
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) {
        if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && isKnownRejection(error.code)) fail("UPLOAD_REJECTED");
      if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      if (error instanceof OwnerFlux3I2vImageProbeError || error instanceof OwnerFlux3V2vOriginalProbeError) fail("PROBE_REJECTED");
      return fail("PROBE_REJECTED");
    } finally {
      if (semanticKey !== undefined && ownsSemanticReservation) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      if (probe) this.#releaseProbe(probe);
      request.bytes.fill(0);
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveReference(input: OwnerFlux3MediaReferenceResolveInput | unknown, signalInput?: AbortSignal): Promise<OwnerFlux3MediaReferenceResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const operation = this.#begin(request.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.handle);
      if (!record || record.attemptId !== request.attemptId || record.modelId !== request.modelId) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      if (record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || !sameGenerationPrincipal(record.principal, principal) ||
          snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client ||
          !readOwnerFlux3UploadReferenceForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");

      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(latest, record.principal) || snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client) {
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId) ||
          !readOwnerFlux3UploadReferenceForClient(record.client, record.nativeReference)) fail("REFERENCE_EXPIRED");

      const resolution: OwnerFlux3MediaReferenceResolution = Object.freeze({
        role: "flux3_media_reference", wire_type: record.wireType, principal: record.principal,
        attempt_id: record.attemptId, model_id: record.modelId, ai_name: "flux3_video",
        source_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION, source_pins: record.sourcePins,
        profile_schema_hash: record.profileHash, flux3_reference_handle: record.handle,
        sha256: record.sourceSha256, mime_type: record.mimeType, size: record.size,
        width: record.width, height: record.height, duration_seconds: record.durationSeconds,
        input_confidence: record.inputConfidence, destination: this.#destination,
        expires_at: record.expiresAt, epoch: record.epoch, generation_permit: false
      });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerFlux3MediaReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedReferenceResolution(value: unknown): boolean {
    try {
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value), record = owned?.record;
      if (!owned || owned.service !== this || !record || this.#records.get(record.handle) !== record ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(record.attemptId) ?? 0) ||
          this.#invalidating.has(record.attemptId) ||
          snapshotNativeClient(this.#resolveClient(record.attemptId)).client !== record.client ||
          !readOwnerFlux3UploadReferenceForClient(record.client, record.nativeReference)) return false;
      return exactResolutionMatches(value, record, this.#destination);
    } catch { return false; }
  }

  withCapturedNativeReference<T>(
    value: unknown,
    consume: (client: SyntxChatHttpClient, context: OwnerFlux3UploadContext) => T
  ): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value) : undefined;
    if (!owned || owned.service !== this || this.#records.get(owned.record.handle) !== owned.record ||
        !this.isOwnedReferenceResolution(value)) fail("REFERENCE_UNAVAILABLE");
    const record = owned.record;
    const currentClient = snapshotNativeClient(this.#resolveClient(record.attemptId)).client;
    if (currentClient !== record.client || !readOwnerFlux3UploadReferenceForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
    return consume(record.client, record.nativeReference);
  }

  invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return Promise.resolve();
    return this.#invalidate(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const invalidations = [...this.#activeAttempts()].map((attemptId) => this.#invalidate(attemptId));
    const pending = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
      this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear();
      this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #probe(request: UploadSnapshot, signal: AbortSignal): Promise<OwnedProbe> | OwnedProbe {
    if (request.modelId === "flux3_i2v") {
      return validateOwnerFlux3I2vImage({ model_id: "flux3_i2v", filename: request.filename,
        mime_type: request.mimeType, bytes: request.bytes });
    }
    return probeOwnerFlux3V2vOriginal({ model_id: "flux3_v2v", filename: request.filename,
      mime_type: "video/mp4", bytes: request.bytes, ffprobePath: this.#ffprobePath }, signal);
  }

  #releaseProbe(probe: OwnedProbe): void {
    if (probe.model_id === "flux3_i2v" && isOwnerFlux3I2vImage(probe)) releaseOwnerFlux3I2vImage(probe);
    else if (probe.model_id === "flux3_v2v" && isOwnerFlux3V2vOriginalProbe(probe)) releaseOwnerFlux3V2vOriginalProbe(probe);
  }

  #facts(probe: OwnedProbe): ProbeFacts {
    const modelId = probe.model_id;
    const profile = getOwnerFlux3VideoSourceProfile(modelId);
    if (!profile || schemaHash(profile) !== this.#profileHashes[modelId] || profile.model_id !== modelId ||
        profile.ai_name !== "flux3_video" || profile.source_pins.public_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION) fail("PROBE_REJECTED");
    if (modelId === "flux3_i2v") {
      if (!isOwnerFlux3I2vImage(probe) || probe.status !== "LOCAL_SOURCE_VALIDATED" || probe.model_id !== modelId ||
          probe.source_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION || probe.dispatch_allowed !== false ||
          probe.generation_permit !== false || probe.owner_upload_binding !== "NOT_ESTABLISHED") fail("PROBE_REJECTED");
      return Object.freeze({ modelId, wireType: "image", filename: probe.filename, mimeType: probe.mime_type,
        sha256: probe.sha256, size: probe.size, width: probe.width, height: probe.height, durationSeconds: null,
        confidence: probe.metadata_confidence, sourcePins: profile.source_pins, profileHash: this.#profileHashes[modelId] });
    }
    if (!isOwnerFlux3V2vOriginalProbe(probe) || probe.status !== "TRUSTED_LOCAL_VIDEO_PROBE" || probe.model_id !== modelId ||
        probe.ai_name !== "flux3_video" || probe.source_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION ||
        probe.dispatch_allowed !== false || probe.owner_upload_binding !== "NOT_ESTABLISHED") fail("PROBE_REJECTED");
    return Object.freeze({ modelId, wireType: "video", filename: probe.filename, mimeType: probe.mime_type,
      sha256: probe.source_sha256, size: probe.bytes_copied, width: probe.metadata.video.width, height: probe.metadata.video.height,
      durationSeconds: probe.metadata.video.duration_seconds, confidence: probe.metadata.inspection,
      sourcePins: profile.source_pins, profileHash: this.#profileHashes[modelId] });
  }

  async #invokeUpload(client: SyntxChatHttpClient, probe: OwnedProbe, signal: AbortSignal): Promise<OwnedUploadContext> {
    if (probe.model_id === "flux3_i2v") {
      return await Reflect.apply(NATIVE_I2V_UPLOAD, client, [probe, this.#destination, signal]) as OwnerFlux3I2vImageUploadContext;
    }
    return await Reflect.apply(NATIVE_V2V_UPLOAD, client, [probe, this.#destination, signal]) as OwnerFlux3V2vOriginalUploadContext;
  }

  #matchesProbe(witness: Readonly<OwnedUploadContext & { url: string }>, probe: OwnedProbe): boolean {
    if (probe.model_id === "flux3_i2v") {
      const context = witness as OwnerFlux3I2vImageUploadContext & Readonly<{ url: string }>;
      return context.status === "OWNER_FLUX3_I2V_IMAGE_UPLOADED" && context.model_id === probe.model_id &&
        context.ai_name === "flux3_video" && context.source_catalog_version === probe.source_catalog_version &&
        context.destination === this.#destination && context.filename === probe.filename &&
        context.source_mime_type === probe.source_mime_type && context.mime_type === probe.mime_type &&
        context.size === probe.size && context.sha256 === probe.sha256 && context.width === probe.width &&
        context.height === probe.height && context.metadata_confidence === probe.metadata_confidence;
    }
    const context = witness as OwnerFlux3V2vOriginalUploadContext & Readonly<{ url: string }>;
    const sourceMeta = probe.metadata, contextMeta = context.metadata;
    return context.status === "OWNER_FLUX3_V2V_ORIGINAL_UPLOADED" && context.model_id === probe.model_id &&
      context.ai_name === "flux3_video" && context.source_catalog_version === probe.source_catalog_version &&
      context.destination === this.#destination && context.filename === probe.filename &&
      context.source_mime_type === probe.mime_type && context.mime_type === probe.mime_type &&
      context.size === probe.bytes_copied && context.sha256 === probe.source_sha256 &&
      contextMeta.container === sourceMeta.container && contextMeta.video.codec_name === sourceMeta.video.codec_name &&
      contextMeta.video.width === sourceMeta.video.width && contextMeta.video.height === sourceMeta.video.height &&
      contextMeta.video.duration_seconds === sourceMeta.video.duration_seconds &&
      contextMeta.container_duration_seconds === sourceMeta.container_duration_seconds &&
      contextMeta.audio_stream_count === sourceMeta.audio_stream_count &&
      contextMeta.local_supported_input_limitation === sourceMeta.local_supported_input_limitation &&
      contextMeta.inspection === sourceMeta.inspection;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerFlux3MediaReferenceServiceError("REQUEST_ABORTED"));
    const pending = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return pending;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerFlux3MediaReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([pending, aborted]).finally(remove);
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal);
    return true;
  }

  #begin(attemptId: string, parent?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    if (!this.#activeAttempts().has(attemptId) && this.#activeAttempts().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation: PendingOperation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort),
      epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount++;
    return operation;
  }

  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (!pending?.size) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount--;
    operation.finish();
    this.#allOperations.delete(operation.done);
    this.#maybeRelease(attemptId);
  }

  #throwIfStopped(operation: PendingOperation): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]);
  }

  #invalidate(attemptId: string): Promise<void> {
    const prior = this.#invalidations.get(attemptId);
    if (prior) return prior;
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptRecords(attemptId);
    this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    const completed = Promise.allSettled(pending).then(() => {
      this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId);
    });
    this.#invalidations.set(attemptId, completed);
    return completed;
  }

  #removeAttemptRecords(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle);
    this.#handlesByAttempt.delete(attemptId);
  }

  #removeRecord(handle: string): void {
    const record = this.#records.get(handle);
    if (!record) return;
    this.#records.delete(handle);
    const handles = this.#handlesByAttempt.get(record.attemptId);
    handles?.delete(handle);
    if (!handles?.size) this.#handlesByAttempt.delete(record.attemptId);
    this.#maybeRelease(record.attemptId);
  }

  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeRecord(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }

  #maybeRelease(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId);
    this.#principalByAttempt.delete(attemptId);
  }

  #semanticKey(principal: Readonly<GenerationPrincipalRef>, facts: ProbeFacts): string {
    return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_id: facts.modelId,
      profile_schema_hash: facts.profileHash, sha256: facts.sha256, mime_type: facts.mimeType, size: facts.size });
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number;
    return value as number;
  }
}

function snapshotUpload(input: unknown): UploadSnapshot {
  const fields = exactRecord(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) ||
      typeof fields.model_id !== "string" || !PROFILE_IDS.includes(fields.model_id as OwnerFlux3VideoModelId) ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || !isSupportedBytes(fields.bytes)) fail("INVALID_REQUEST");
  const modelId = fields.model_id as OwnerFlux3VideoModelId;
  const profile = getOwnerFlux3VideoSourceProfile(modelId);
  if (!profile || !profile.input.accepted_file_types.includes(fields.mime_type as never)) fail("INVALID_REQUEST");
  const byteLength = intrinsicByteLength(fields.bytes);
  if (byteLength < 1) fail("INVALID_REQUEST");
  if (byteLength > profile.input.max_file_size_bytes) fail("INVALID_REQUEST");
  const maximumBytes = modelId === "flux3_i2v" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (byteLength > maximumBytes) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, modelId, filename: fields.filename,
    mimeType: fields.mime_type, bytes: snapshotBytes(fields.bytes) });
}

function snapshotResolve(input: unknown): Readonly<{ attemptId: string; modelId: OwnerFlux3VideoModelId; handle: string }> {
  const fields = exactRecord(input, ["attemptId", "model_id", "flux3_reference_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.model_id !== "string" ||
      !PROFILE_IDS.includes(fields.model_id as OwnerFlux3VideoModelId) || typeof fields.flux3_reference_handle !== "string" ||
      !HANDLE.test(fields.flux3_reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, modelId: fields.model_id as OwnerFlux3VideoModelId,
    handle: fields.flux3_reference_handle });
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadFlux3I2vImage") || Object.hasOwn(value, "uploadFlux3V2vOriginal") ||
        getDataMethod(value, "uploadFlux3I2vImage") !== NATIVE_I2V_UPLOAD || getDataMethod(value, "uploadFlux3V2vOriginal") !== NATIVE_V2V_UPLOAD ||
        SyntxChatHttpClient.prototype.uploadFlux3I2vImage !== NATIVE_I2V_UPLOAD ||
        SyntxChatHttpClient.prototype.uploadFlux3V2vOriginal !== NATIVE_V2V_UPLOAD ||
        Reflect.get(value, "uploadFlux3I2vImage") !== NATIVE_I2V_UPLOAD || Reflect.get(value, "uploadFlux3V2vOriginal") !== NATIVE_V2V_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) {
    if (error instanceof OwnerFlux3MediaReferenceServiceError) throw error;
    return fail("INVALID_REQUEST");
  }
}

function exactResolutionMatches(value: object, record: ReferenceRecord, destination: OwnerFlux3UploadDestination): boolean {
  try {
    const fields = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "model_id", "ai_name",
      "source_catalog_version", "source_pins", "profile_schema_hash", "flux3_reference_handle", "sha256", "mime_type", "size",
      "width", "height", "duration_seconds", "input_confidence", "destination", "expires_at", "epoch", "generation_permit"]);
    return fields.role === "flux3_media_reference" && fields.wire_type === record.wireType && fields.attempt_id === record.attemptId &&
      fields.model_id === record.modelId && fields.ai_name === "flux3_video" &&
      fields.source_catalog_version === OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION && fields.source_pins === record.sourcePins &&
      fields.profile_schema_hash === record.profileHash && fields.flux3_reference_handle === record.handle &&
      fields.sha256 === record.sourceSha256 && fields.mime_type === record.mimeType && fields.size === record.size &&
      fields.width === record.width && fields.height === record.height && fields.duration_seconds === record.durationSeconds &&
      fields.input_confidence === record.inputConfidence && fields.destination === destination && fields.expires_at === record.expiresAt &&
      fields.epoch === record.epoch && fields.generation_permit === false && samePrincipal(fields.principal, record.principal);
  } catch { return false; }
}

function samePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(snapshotGenerationPrincipal(value as GenerationPrincipalRef), expected); } catch { return false; }
}

function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal)) fail("INVALID_REQUEST");
  return signal;
}

function isSupportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== UINT8_ARRAY_PROTOTYPE && !Buffer.isBuffer(value))) return false;
  if (["buffer", "byteLength", "byteOffset", "length"].some((key) => Object.hasOwn(value, key))) return false;
  try {
    if (!TYPED_ARRAY_BYTE_LENGTH || !TYPED_ARRAY_BUFFER || !TYPED_ARRAY_BYTE_OFFSET) return false;
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []);
    return backing instanceof ArrayBuffer && Object.getPrototypeOf(backing) === ArrayBuffer.prototype &&
      Number.isSafeInteger(Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, [])) &&
      Number.isSafeInteger(Reflect.apply(TYPED_ARRAY_BYTE_OFFSET, value, []));
  } catch { return false; }
}

function snapshotBytes(value: Uint8Array): Buffer {
  if (!TYPED_ARRAY_BUFFER || !TYPED_ARRAY_BYTE_OFFSET) return fail("INVALID_REQUEST");
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET, value, []) as number;
  const length = intrinsicByteLength(value);
  return Buffer.from(new Uint8Array(backing, offset, length));
}

function intrinsicByteLength(value: Uint8Array): number {
  try { if (!TYPED_ARRAY_BYTE_LENGTH) fail("INVALID_REQUEST"); return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, []) as number; }
  catch { return fail("INVALID_REQUEST"); }
}

function isGenuineLinkService(value: unknown): value is PerUserLinkService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
      PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS && typeof descriptor.value === "function";
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let result: unknown;
    try { result = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED");
    return result as number;
  };
}

function isKnownRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}

function fail(code: OwnerFlux3MediaReferenceServiceErrorCode): never {
  throw new OwnerFlux3MediaReferenceServiceError(code);
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
