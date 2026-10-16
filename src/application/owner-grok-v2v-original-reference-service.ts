import { randomUUID, createHash } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import {
  SyntxChatHttpClient,
  readOwnerGrokV2vUploadReferenceForClient
} from "../adapter/syntx/chat-http-client.js";
import type { OwnerGrokV2vUploadContext, OwnerGrokV2vUploadDestination } from "../adapter/syntx/grok-v2v-media-upload.js";
import {
  isOwnerGrokV2vOriginalProbe,
  probeOwnerGrokV2vOriginal,
  releaseOwnerGrokV2vOriginalProbe,
  OwnerGrokV2vOriginalProbeError,
  type OwnerGrokV2vOriginalProbeResult
} from "./owner-grok-v2v-original-probe.js";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
  type OwnerGrokV2vSourceProfile
} from "./owner-grok-v2v-source-profile.js";

const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^grok_v2v_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_INPUT_BYTES = 52_428_800;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 8.7;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadGrokV2vOriginal;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerGrokV2vOriginalReferenceService; readonly record: ReferenceRecord }>();
const REFERENCE_SERVICES = new WeakSet<object>();
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;

export type OwnerGrokV2vInputConfidence = "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE";

export interface OwnerGrokV2vOriginalReferenceServiceOptions {
  readonly ffprobePath: string;
  readonly destination: OwnerGrokV2vUploadDestination;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerGrokV2vOriginalReferenceUploadInput {
  readonly attemptId: string;
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly bytes: Uint8Array;
}

export interface OwnerGrokV2vOriginalReferenceUploadReceipt {
  readonly status: "uploaded";
  readonly grok_reference_handle: string;
  readonly model_id: typeof MODEL_ID;
  readonly mime_type: OwnerGrokV2vOriginalProbeResult["mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly input_confidence: OwnerGrokV2vInputConfidence;
  readonly expires_in_seconds: number;
}

export interface OwnerGrokV2vOriginalReferenceResolveInput {
  readonly attemptId: string;
  readonly model_id: typeof MODEL_ID;
  readonly grok_reference_handle: string;
}

export interface OwnerGrokV2vOriginalReferenceResolution {
  readonly role: "grok_v2v_original_reference";
  readonly wire_type: "video";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_catalog_version: typeof OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION;
  readonly source_pins: OwnerGrokV2vSourceProfile["source_pins"];
  readonly profile_schema_hash: string;
  readonly grok_reference_handle: string;
  readonly source_sha256: string;
  readonly filename: string;
  readonly mime_type: OwnerGrokV2vOriginalProbeResult["mime_type"];
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly container: OwnerGrokV2vOriginalProbeResult["metadata"]["container"];
  readonly video_codec: string;
  readonly duration_confidence: "CONTAINER_DURATION_SECONDS_LOCAL_POLICY";
  readonly input_confidence: OwnerGrokV2vInputConfidence;
  readonly metadata: OwnerGrokV2vOriginalProbeResult["metadata"];
  readonly destination: OwnerGrokV2vUploadDestination;
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}

export type OwnerGrokV2vOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "PROBE_REJECTED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerGrokV2vOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerGrokV2vOriginalReferenceServiceErrorCode) {
    super("The owner Grok V2V original reference is unavailable.");
    this.name = "OwnerGrokV2vOriginalReferenceServiceError";
  }
}

interface ReferenceRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly sourcePins: OwnerGrokV2vSourceProfile["source_pins"];
  readonly profileHash: string;
  readonly sourceSha256: string;
  readonly size: number;
  readonly filename: string;
  readonly mimeType: OwnerGrokV2vOriginalProbeResult["mime_type"];
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly metadata: OwnerGrokV2vOriginalProbeResult["metadata"];
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnerGrokV2vUploadContext;
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
  readonly filename: string;
  readonly mimeType: OwnerGrokV2vOriginalProbeResult["mime_type"];
  readonly bytes: Buffer;
}

interface ProbeFacts {
  readonly filename: string;
  readonly mimeType: OwnerGrokV2vOriginalProbeResult["mime_type"];
  readonly sha256: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly metadata: OwnerGrokV2vOriginalProbeResult["metadata"];
  readonly sourcePins: OwnerGrokV2vSourceProfile["source_pins"];
  readonly profileHash: string;
}

interface ResolveSnapshot {
  readonly attemptId: string;
  readonly handle: string;
}

/** One-owner, one-shot V2V reference uploads. References are not generation permission. */
export class OwnerGrokV2vOriginalReferenceService {
  readonly #ffprobePath: string;
  readonly #destination: OwnerGrokV2vUploadDestination;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #now: () => number;
  readonly #profileHash: string;
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

  constructor(optionsInput: OwnerGrokV2vOriginalReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["ffprobePath", "destination", "binding", "linkService", "resolveClient"], ["now"]);
    if (typeof fields.ffprobePath !== "string" || !fields.ffprobePath ||
        (fields.destination !== "uploaded" && fields.destination !== "hidden") || !isGenuineLinkService(fields.linkService) ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
    if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.model_id !== MODEL_ID ||
        profile.ai_name !== AI_NAME || profile.source_pins.public_catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION ||
        profile.input.role !== "video" || profile.input.file_count_limit !== 1 ||
        profile.input.max_file_size_bytes !== MAX_INPUT_BYTES || profile.input.accepted_file_types.length !== 2 ||
        profile.input.accepted_file_types[0] !== "video/mp4" || profile.input.accepted_file_types[1] !== "video/quicktime" ||
        profile.input.total_duration_seconds.minimum !== MIN_DURATION_SECONDS ||
        profile.input.total_duration_seconds.maximum !== MAX_DURATION_SECONDS ||
        profile.runtime_usable !== false || profile.dispatch_allowed !== false) fail("INVALID_REQUEST");
    this.#ffprobePath = fields.ffprobePath;
    this.#destination = fields.destination;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#profileHash = schemaHash(profile);
    REFERENCE_SERVICES.add(this);
    Object.freeze(this);
  }

  async uploadReference(
    input: OwnerGrokV2vOriginalReferenceUploadInput | unknown,
    signalInput?: AbortSignal
  ): Promise<OwnerGrokV2vOriginalReferenceUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input);
    let operation: PendingOperation;
    try { operation = this.#begin(request.attemptId, exactSignal(signalInput)); }
    catch (error) { request.bytes.fill(0); throw error; }

    let probe: Readonly<OwnerGrokV2vOriginalProbeResult> | undefined;
    let semanticKey: string | undefined;
    let ownsSemanticReservation = false;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = snapshotNativeClient(this.#resolveClient(request.attemptId));
      probe = await probeOwnerGrokV2vOriginal({ model_id: MODEL_ID, filename: request.filename,
        mime_type: request.mimeType, bytes: request.bytes, ffprobePath: this.#ffprobePath }, operation.controller.signal);
      this.#throwIfStopped(operation);
      const facts = this.#facts(probe, request);
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
      const currentProfile = getOwnerGrokV2vSourceProfile(MODEL_ID);
      if (!currentProfile || schemaHash(currentProfile) !== this.#profileHash) fail("PROBE_REJECTED");
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      const nativeReference = await Reflect.apply(NATIVE_UPLOAD, clientBeforeUpload.client,
        [probe, this.#destination, operation.controller.signal]) as OwnerGrokV2vUploadContext;
      this.#throwIfStopped(operation);
      const witness = readOwnerGrokV2vUploadReferenceForClient(clientBeforeUpload.client, nativeReference);
      if (!witness || !this.#matchesProbe(witness, probe, facts)) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }

      let afterUpload: Readonly<GenerationPrincipalRef>;
      try { afterUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal); }
      catch { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#throwIfStopped(operation);
      const clientAfterUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, afterUpload) || clientAfterUpload.client !== clientBeforeUpload.client ||
          !readOwnerGrokV2vUploadReferenceForClient(clientBeforeUpload.client, nativeReference)) {
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

      const handle = `grok_v2v_reference_${randomUUID()}`;
      const record: ReferenceRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        sourcePins: facts.sourcePins, profileHash: facts.profileHash, sourceSha256: facts.sha256,
        size: facts.size, filename: facts.filename, mimeType: facts.mimeType, width: facts.width, height: facts.height,
        durationSeconds: facts.durationSeconds, metadata: facts.metadata, expiresAt, epoch: operation.epoch,
        client: clientBeforeUpload.client, nativeReference });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", grok_reference_handle: handle, model_id: MODEL_ID,
        mime_type: record.mimeType, size: record.size, sha256: record.sourceSha256, width: record.width,
        height: record.height, duration_seconds: record.durationSeconds,
        input_confidence: "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE", expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1_000) });
    } catch (error) {
      if (error instanceof OwnerGrokV2vOriginalReferenceServiceError) {
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
      if (error instanceof OwnerGrokV2vOriginalProbeError) fail("PROBE_REJECTED");
      return fail("PROBE_REJECTED");
    } finally {
      if (semanticKey !== undefined && ownsSemanticReservation) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      if (probe && isOwnerGrokV2vOriginalProbe(probe)) {
        try { releaseOwnerGrokV2vOriginalProbe(probe); } catch { /* Preserve the operation outcome; no probe escapes this service. */ }
      }
      request.bytes.fill(0);
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveReference(
    input: OwnerGrokV2vOriginalReferenceResolveInput | unknown,
    signalInput?: AbortSignal
  ): Promise<OwnerGrokV2vOriginalReferenceResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const operation = this.#begin(request.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.handle);
      if (!record || record.attemptId !== request.attemptId || record.handle !== request.handle) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      if (record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || !sameGenerationPrincipal(record.principal, principal) ||
          snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client ||
          !readOwnerGrokV2vUploadReferenceForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");

      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(latest, record.principal) || snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client) {
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId) ||
          !readOwnerGrokV2vUploadReferenceForClient(record.client, record.nativeReference)) fail("REFERENCE_EXPIRED");

      const resolution: OwnerGrokV2vOriginalReferenceResolution = Object.freeze({
        role: "grok_v2v_original_reference", wire_type: "video", principal: record.principal,
        attempt_id: record.attemptId, model_id: MODEL_ID, ai_name: AI_NAME,
        source_catalog_version: OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION, source_pins: record.sourcePins,
        profile_schema_hash: record.profileHash, grok_reference_handle: record.handle,
        source_sha256: record.sourceSha256, filename: record.filename, mime_type: record.mimeType,
        size: record.size, width: record.width, height: record.height, duration_seconds: record.durationSeconds,
        container: record.metadata.container, video_codec: record.metadata.video.codec_name,
        duration_confidence: record.metadata.duration_confidence, input_confidence: "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE",
        metadata: record.metadata, destination: this.#destination, expires_at: record.expiresAt,
        epoch: record.epoch, generation_permit: false
      });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerGrokV2vOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedReferenceResolution(value: unknown, expectedInput?: unknown): boolean {
    try {
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value), record = owned?.record;
      if (!owned || owned.service !== this || !record || this.#records.get(record.handle) !== record ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(record.attemptId) ?? 0) ||
          this.#invalidating.has(record.attemptId) || snapshotNativeClient(this.#resolveClient(record.attemptId)).client !== record.client ||
          !readOwnerGrokV2vUploadReferenceForClient(record.client, record.nativeReference) ||
          !exactResolutionMatches(value, record, this.#destination)) return false;
      if (expectedInput !== undefined) {
        const expected = snapshotResolve(expectedInput);
        if (expected.attemptId !== record.attemptId || expected.handle !== record.handle) return false;
      }
      return true;
    } catch { return false; }
  }

  withCapturedNativeReference<T>(
    value: unknown,
    consume: (client: SyntxChatHttpClient, context: OwnerGrokV2vUploadContext) => T
  ): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value) : undefined;
    if (!owned || owned.service !== this || this.#records.get(owned.record.handle) !== owned.record ||
        !this.isOwnedReferenceResolution(value)) fail("REFERENCE_UNAVAILABLE");
    const record = owned.record;
    if (snapshotNativeClient(this.#resolveClient(record.attemptId)).client !== record.client ||
        !readOwnerGrokV2vUploadReferenceForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
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

  #facts(probe: Readonly<OwnerGrokV2vOriginalProbeResult>, request: UploadSnapshot): ProbeFacts {
    const profile = getOwnerGrokV2vSourceProfile(MODEL_ID), metadata = probe.metadata;
    if (!profile || schemaHash(profile) !== this.#profileHash || profile.model_id !== MODEL_ID || profile.ai_name !== AI_NAME ||
        probe.status !== "TRUSTED_LOCAL_VIDEO_PROBE" || probe.model_id !== MODEL_ID || probe.ai_name !== AI_NAME ||
        probe.source_catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION || probe.source_pins !== profile.source_pins ||
        probe.filename !== request.filename || probe.mime_type !== request.mimeType ||
        (probe.mime_type === "video/mp4" && metadata.container !== "ISO_BMFF_MP4") ||
        (probe.mime_type === "video/quicktime" && metadata.container !== "QUICKTIME_MOV") ||
        !Object.isFrozen(metadata) || !Object.isFrozen(metadata.video) || !safeCodec(metadata.video.codec_name) ||
        !positiveInteger(metadata.video.width) || !positiveInteger(metadata.video.height) ||
        !finiteWithin(metadata.duration_seconds, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS) ||
        metadata.duration_confidence !== "CONTAINER_DURATION_SECONDS_LOCAL_POLICY" ||
        metadata.inspection !== "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" || probe.dispatch_allowed !== false ||
        probe.owner_upload_binding !== "NOT_ESTABLISHED" || probe.source_size_bytes !== request.bytes.byteLength ||
        createHash("sha256").update(request.bytes).digest("hex") !== probe.source_sha256) fail("PROBE_REJECTED");
    return Object.freeze({ filename: probe.filename, mimeType: probe.mime_type, sha256: probe.source_sha256,
      size: probe.source_size_bytes, width: metadata.video.width, height: metadata.video.height,
      durationSeconds: metadata.duration_seconds, metadata, sourcePins: profile.source_pins, profileHash: this.#profileHash });
  }

  #matchesProbe(
    witness: Readonly<OwnerGrokV2vUploadContext & { url: string }>,
    probe: Readonly<OwnerGrokV2vOriginalProbeResult>,
    facts: ProbeFacts
  ): boolean {
    return witness.status === "OWNER_GROK_V2V_ORIGINAL_UPLOADED" && witness.model_id === MODEL_ID && witness.ai_name === AI_NAME &&
      witness.source_catalog_version === OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION && witness.destination === this.#destination &&
      witness.filename === facts.filename && witness.source_mime_type === facts.mimeType && witness.mime_type === facts.mimeType &&
      witness.size === facts.size && witness.sha256 === facts.sha256 && witness.metadata === probe.metadata &&
      witness.metadata.duration_seconds === facts.durationSeconds;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerGrokV2vOriginalReferenceServiceError("REQUEST_ABORTED"));
    const pending = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return pending;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerGrokV2vOriginalReferenceServiceError("REQUEST_ABORTED"));
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
    const operation: PendingOperation = { controller, done, finish,
      removeParentAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attemptId) ?? 0 };
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
    return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_id: MODEL_ID,
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

export function isOwnerGrokV2vOriginalReferenceService(value: unknown): value is OwnerGrokV2vOriginalReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && REFERENCE_SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerGrokV2vOriginalReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(input: unknown): UploadSnapshot {
  const fields = exactRecord(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || fields.model_id !== MODEL_ID ||
      typeof fields.filename !== "string" || !safeFilename(fields.filename) || typeof fields.mime_type !== "string" ||
      !isSupportedBytes(fields.bytes)) fail("INVALID_REQUEST");
  const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
  if (!profile || !profile.input.accepted_file_types.includes(fields.mime_type as "video/mp4" | "video/quicktime")) fail("INVALID_REQUEST");
  const mimeType = fields.mime_type as OwnerGrokV2vOriginalProbeResult["mime_type"];
  const extension = fields.filename.toLowerCase().split(".").at(-1);
  if (mimeType === "video/mp4" && extension !== "mp4" || mimeType === "video/quicktime" && extension !== "mov") fail("INVALID_REQUEST");
  const byteLength = intrinsicByteLength(fields.bytes);
  if (byteLength < 16) fail("INVALID_REQUEST");
  if (byteLength > profile.input.max_file_size_bytes || byteLength > MAX_INPUT_BYTES) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, filename: fields.filename, mimeType, bytes: snapshotBytes(fields.bytes) });
}

function snapshotResolve(input: unknown): ResolveSnapshot {
  const fields = exactRecord(input, ["attemptId", "model_id", "grok_reference_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || fields.model_id !== MODEL_ID ||
      typeof fields.grok_reference_handle !== "string" || !HANDLE.test(fields.grok_reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, handle: fields.grok_reference_handle });
}

function exactResolutionMatches(value: object, record: ReferenceRecord, destination: OwnerGrokV2vUploadDestination): boolean {
  try {
    const fields = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "model_id", "ai_name", "source_catalog_version",
      "source_pins", "profile_schema_hash", "grok_reference_handle", "source_sha256", "filename", "mime_type", "size", "width",
      "height", "duration_seconds", "container", "video_codec", "duration_confidence", "input_confidence", "metadata",
      "destination", "expires_at", "epoch", "generation_permit"]);
    return fields.role === "grok_v2v_original_reference" && fields.wire_type === "video" && fields.principal === record.principal &&
      fields.attempt_id === record.attemptId && fields.model_id === MODEL_ID && fields.ai_name === AI_NAME &&
      fields.source_catalog_version === OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION && fields.source_pins === record.sourcePins &&
      fields.profile_schema_hash === record.profileHash && fields.grok_reference_handle === record.handle &&
      fields.source_sha256 === record.sourceSha256 && fields.filename === record.filename && fields.mime_type === record.mimeType &&
      fields.size === record.size && fields.width === record.width && fields.height === record.height &&
      fields.duration_seconds === record.durationSeconds && fields.container === record.metadata.container &&
      fields.video_codec === record.metadata.video.codec_name && fields.duration_confidence === record.metadata.duration_confidence &&
      fields.input_confidence === "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" && fields.metadata === record.metadata &&
      fields.destination === destination && fields.expires_at === record.expiresAt && fields.epoch === record.epoch && fields.generation_permit === false;
  } catch { return false; }
}

function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadGrokV2vOriginal") || getDataMethod(value, "uploadGrokV2vOriginal") !== NATIVE_UPLOAD ||
        SyntxChatHttpClient.prototype.uploadGrokV2vOriginal !== NATIVE_UPLOAD || Reflect.get(value, "uploadGrokV2vOriginal") !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) {
    if (error instanceof OwnerGrokV2vOriginalReferenceServiceError) throw error;
    return fail("INVALID_REQUEST");
  }
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) ||
      Object.getPrototypeOf(signal) !== AbortSignal.prototype) fail("INVALID_REQUEST");
  return signal;
}

function isSupportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== UINT8_ARRAY_PROTOTYPE && !Buffer.isBuffer(value)) ||
      ["buffer", "byteLength", "byteOffset", "length"].some((key) => Object.hasOwn(value, key))) return false;
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
  return Buffer.from(new Uint8Array(backing, offset, intrinsicByteLength(value)));
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

function safeFilename(filename: string): boolean {
  return filename.length > 0 && filename.length <= 255 && filename === filename.trimEnd() && filename !== "." && filename !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(filename) && !/[. ]$/u.test(filename) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(filename);
}

function safeCodec(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9_+-]{1,64}$/iu.test(value); }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function finiteWithin(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isKnownRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
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

function fail(code: OwnerGrokV2vOriginalReferenceServiceErrorCode): never {
  throw new OwnerGrokV2vOriginalReferenceServiceError(code);
}
