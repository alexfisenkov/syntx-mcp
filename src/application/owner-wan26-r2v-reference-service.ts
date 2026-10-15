import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import {
  OwnerReferencePrincipalError,
  resolveOwnerReferencePrincipal
} from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import type { OwnerWan26R2vImageUploadContext } from "../adapter/syntx/wan26-r2v-upload-context.js";
import {
  readOwnerWan26R2vVideoUploadReferenceForClient,
  type OwnerWan26R2vSelectedVideoUploadContext
} from "../adapter/syntx/wan26-r2v-video-upload-context.js";
import {
  isOwnerWan26R2vImageUploadContextForClient,
  readOwnerWan26R2vUploadReferenceForClient
} from "../adapter/syntx/wan26-r2v-upload-context.js";
import {
  validateOwnerWan26R2vImage,
  readValidatedOwnerWan26R2vImage,
  releaseValidatedOwnerWan26R2vImage,
  type OwnerWan26R2vModelId
} from "./owner-wan26-r2v-image-policy.js";
import {
  createOwnerWan26R2vOriginalProbe,
  copyTrustedOwnerWan26R2vOriginalBytes,
  releaseTrustedOwnerWan26R2vOriginalProbeResult,
  type OwnerWan26R2vOriginalProbeResult
} from "./owner-wan26-r2v-original-probe.js";
import {
  validateOwnerWan26R2vVideoSelection,
  OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY
} from "./owner-wan26-r2v-video-selection.js";
import {
  createOwnerWan26R2vVideoCropProcessor,
  copyTrustedOwnerWan26R2vVideoCropBytes,
  releaseTrustedOwnerWan26R2vVideoCropReceipt,
  type OwnerWan26R2vVideoCropReceipt
} from "./owner-wan26-r2v-video-crop.js";

const MODELS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL = 900_000;
const MAX_RECORDS = 128;
const MAX_ATTEMPTS = 128;
const PENDING_MAX = 4;
const NATIVE_IMAGE = SyntxChatHttpClient.prototype.uploadWan26R2vImage;
const NATIVE_VIDEO = SyntxChatHttpClient.prototype.uploadWan26R2vSelectedVideo;
const RESOLUTIONS = new WeakMap<object, { service: OwnerWan26R2vReferenceService; records: RecordItem[]; input: ResolveInput }>();
const ABORT_SIGNAL_PROTO = AbortSignal.prototype;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(ABORT_SIGNAL_PROTO, "aborted")?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

export interface OwnerWan26R2vReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly ffprobePath: string;
  readonly ffmpegPath: string;
  readonly now?: () => number;
}

export interface OwnerWan26R2vImageInput {
  readonly attemptId: string;
  readonly model_id: OwnerWan26R2vModelId;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}

export interface OwnerWan26R2vVideoInput extends OwnerWan26R2vImageInput {
  readonly start_seconds: number;
  readonly end_seconds: number;
  readonly total_reference_count: number;
}

export interface OwnerWan26R2vResolveInput {
  readonly attempt_id: string;
  readonly model_id: OwnerWan26R2vModelId;
  readonly reference_handles: readonly string[];
}

export interface OwnerWan26R2vReferenceReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: OwnerWan26R2vModelId;
  readonly media_type: "image" | "selected_video";
  readonly mime_type: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly source_policy_id: string;
  readonly reference_proof: "LOCAL_VALIDATION_AND_NATIVE_UPLOAD_NOT_PROVIDER_ACCEPTANCE";
  readonly selection_policy_id?: string;
  readonly selected_duration_seconds?: number;
  readonly video_duration_seconds?: number;
  readonly source_sha256?: string;
  readonly expires_in_seconds: 900;
  readonly generation_permit: false;
}

export interface OwnerWan26R2vReferenceManifest {
  readonly status: "ready";
  readonly model_id: OwnerWan26R2vModelId;
  readonly references: readonly OwnerWan26R2vReferenceReceipt[];
  readonly image_count: number;
  readonly video_count: number;
  readonly total_reference_count: number;
  readonly expires_at: number;
  readonly generation_permit: false;
}

export type OwnerWan26R2vNativeReferenceConsumer<T> = (
  client: SyntxChatHttpClient,
  references: readonly (OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext)[]
) => T | Promise<T>;

export class OwnerWan26R2vReferenceServiceError extends Error {
  constructor(readonly code: string) {
    super("WAN 2.6 R2V references are unavailable.");
    this.name = "OwnerWan26R2vReferenceServiceError";
  }
}

interface RecordItem {
  handle: string;
  attempt: string;
  model: OwnerWan26R2vModelId;
  principal: Readonly<GenerationPrincipalRef>;
  client: SyntxChatHttpClient;
  context: OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext;
  receipt: OwnerWan26R2vReferenceReceipt;
  kind: "image" | "selected_video";
  expires: number;
  epoch: number;
}
type ResolveInput = Readonly<{ attempt_id: string; model_id: OwnerWan26R2vModelId; reference_handles: readonly string[] }>;

/** Process-local, owner-bound WAN26 R2V reference inputs. A manifest grants no generation authority. */
export class OwnerWan26R2vReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #resolveClient: (id: string) => unknown;
  readonly #probe: ReturnType<typeof createOwnerWan26R2vOriginalProbe>;
  readonly #crop: ReturnType<typeof createOwnerWan26R2vVideoCropProcessor>;
  readonly #now: () => number;
  readonly #records = new Map<string, RecordItem>();
  readonly #principal = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #epochs = new Map<string, number>();
  readonly #pending = new Map<string, Set<Operation>>();
  readonly #work = new Set<Promise<void>>();
  readonly #pendingSemantic = new Set<string>();
  readonly #unknownSemantic = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #last = -1;
  constructor(options: OwnerWan26R2vReferenceServiceOptions | unknown) {
    const fields = exact(options, ["binding", "linkService", "resolveClient", "ffprobePath", "ffmpegPath"], ["now"]);
    const binding = exact(fields.binding, ["tenant_id", "subject"]);
    if (types.isProxy(fields.linkService) || !(fields.linkService instanceof PerUserLinkService) ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        typeof binding.tenant_id !== "string" || !binding.tenant_id ||
        typeof binding.subject !== "string" || !binding.subject ||
        typeof fields.ffprobePath !== "string" || typeof fields.ffmpegPath !== "string" ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) {
      fail("INVALID_REQUEST");
    }
    this.#binding = Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }) as AuthBinding;
    this.#links = fields.linkService;
    this.#resolveClient = fields.resolveClient as (id: string) => unknown;
    this.#probe = createOwnerWan26R2vOriginalProbe({ ffprobePath: fields.ffprobePath });
    this.#crop = createOwnerWan26R2vVideoCropProcessor({ ffmpegPath: fields.ffmpegPath, ffprobePath: fields.ffprobePath });
    this.#now = (fields.now as (() => number) | undefined) ?? (() => performance.now());
    Object.freeze(this);
  }
  async uploadImage(input: OwnerWan26R2vImageInput | unknown, signal?: AbortSignal): Promise<OwnerWan26R2vReferenceReceipt> {
    return this.#upload(input, "image", signal);
  }

  async uploadSelectedVideo(input: OwnerWan26R2vVideoInput | unknown, signal?: AbortSignal): Promise<OwnerWan26R2vReferenceReceipt> {
    return this.#upload(input, "selected_video", signal);
  }

  async resolveManifest(input: OwnerWan26R2vResolveInput | unknown, signal?: AbortSignal): Promise<OwnerWan26R2vReferenceManifest> {
    this.#open();
    const fields = exact(input, ["attempt_id", "model_id", "reference_handles"]);
    if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
        typeof fields.model_id !== "string" || !MODELS.includes(fields.model_id as OwnerWan26R2vModelId)) {
      return fail("INVALID_REQUEST");
    }
    const handles = readHandleArray(fields.reference_handles);
    if (handles.length < 1 || handles.length > 5 || new Set(handles).size !== handles.length) {
      fail("INVALID_REQUEST");
    }
    const attempt = fields.attempt_id;
    const model = fields.model_id as OwnerWan26R2vModelId;
    const candidates = handles.map((handle) => this.#records.get(handle));
    if (candidates.some((record) => !record || record.attempt !== attempt || record.model !== model)) {
      fail("REFERENCE_UNAVAILABLE");
    }
    const records = candidates as RecordItem[];
    const images = records.filter((record) => record.kind === "image");
    const videos = records.filter((record) => record.kind === "selected_video");
    if (images.length > 2 || videos.length > 3 || images.length + videos.length !== records.length) {
      fail("REFERENCE_LIMIT_EXCEEDED");
    }
    if (videos.some((record) => !this.#videoWithinCap(record, records.length))) {
      fail("REFERENCE_LIMIT_EXCEEDED");
    }

    const operation = this.#begin(attempt, signal);
    try {
      const client = await this.#client(operation);
      const principal = await this.#principalFor(operation);
      this.#check(operation);
      this.#assertRecordsLive(records, attempt, model, principal, client, operation.epoch);
      const typedUrls = records.map((record) => `${record.kind}:${this.#url(record) ?? ""}`);
      if (typedUrls.some((url) => url.endsWith(":")) || new Set(typedUrls).size !== typedUrls.length) {
        fail("DUPLICATE_REFERENCE");
      }
      const receipts = Object.freeze(records.map((record) => record.receipt));
      const manifest = Object.freeze({
        status: "ready" as const,
        model_id: model,
        references: receipts,
        image_count: images.length,
        video_count: videos.length,
        total_reference_count: records.length,
        expires_at: Math.min(...records.map((record) => record.expires)),
        generation_permit: false as const
      });
      RESOLUTIONS.set(manifest, {
        service: this,
        records: [...records],
        input: normalizeInput(attempt, model, handles)
      });
      return manifest;
    } finally {
      this.#finish(attempt, operation);
    }
  }
  isOwnedManifest(value: unknown): boolean {
    if (this.#closed || !value || typeof value !== "object" || types.isProxy(value)) return false;
    const state = RESOLUTIONS.get(value);
    return !!state && state.service === this && state.records.length > 0 &&
      state.records.every((record) => this.#isLiveRecord(record));
  }

  async withCapturedNativeReferences<T>(
    value: unknown,
    consume: OwnerWan26R2vNativeReferenceConsumer<T>,
    signal?: AbortSignal
  ): Promise<T> {
    this.#open();
    if (typeof consume !== "function" || types.isProxy(consume) || !value ||
        typeof value !== "object" || types.isProxy(value)) fail("INVALID_REQUEST");
    const state = RESOLUTIONS.get(value);
    if (!state || state.service !== this || !this.isOwnedManifest(value)) fail("REFERENCE_UNAVAILABLE");
    const attempt = state.records[0]!.attempt;
    const operation = this.#begin(attempt, signal);
    try {
      await this.#verify(state.records, operation);
      const contexts = Object.freeze(state.records.map((record) => record.context));
      const result = await consume(state.records[0]!.client, contexts);
      await this.#verify(state.records, operation);
      return result;
    } finally {
      this.#finish(attempt, operation);
    }
  }

  async invalidateAttempt(value: unknown): Promise<void> {
    if (typeof value !== "string" || !ATTEMPT.test(value)) return;
    await this.#revoke(value);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = this.#drainAndClear();
    return this.#closing;
  }

  async #drainAndClear(): Promise<void> {
    const attempts = this.#trackedAttempts();
    const revocations = [...attempts].map((attempt) => this.#revoke(attempt));
    await Promise.allSettled([...revocations, ...this.#work]);
    this.#records.clear();
    this.#principal.clear();
    this.#clients.clear();
    this.#epochs.clear();
    this.#pendingSemantic.clear();
    this.#unknownSemantic.clear();
    this.#invalidating.clear();
  }
  async #upload(value: unknown, kind: RecordItem["kind"], signal?: AbortSignal): Promise<OwnerWan26R2vReferenceReceipt> {
    this.#open();
    const fields = exact(value, kind === "image"
      ? ["attemptId", "model_id", "content_base64", "filename", "mime_type"]
      : ["attemptId", "model_id", "content_base64", "filename", "mime_type", "start_seconds", "end_seconds", "total_reference_count"]);
    const attempt = fields.attemptId;
    if (typeof attempt !== "string" || !ATTEMPT.test(attempt) ||
        typeof fields.model_id !== "string" || !MODELS.includes(fields.model_id as OwnerWan26R2vModelId) ||
        typeof fields.content_base64 !== "string" || fields.content_base64.length > 140_000_000 ||
        typeof fields.filename !== "string" || typeof fields.mime_type !== "string") {
      fail("INVALID_REQUEST");
    }
    const model = fields.model_id as OwnerWan26R2vModelId;
    const operation = this.#begin(attempt, signal);
    let decoded: Buffer | undefined;
    let image: ReturnType<typeof validateOwnerWan26R2vImage> | undefined;
    let original: Readonly<OwnerWan26R2vOriginalProbeResult> | undefined;
    let crop: Readonly<OwnerWan26R2vVideoCropReceipt> | undefined;
    let posted = false;
    let claimed = false;
    let semanticKey: string | undefined;

    try {
      decoded = decode(fields.content_base64);
      const principal = await this.#principalFor(operation);
      const client = await this.#client(operation);
      this.#check(operation);

      if (kind === "image") {
        image = validateOwnerWan26R2vImage({
          model_id: model,
          filename: fields.filename,
          mime_type: fields.mime_type,
          bytes: decoded
        });
        const owned = readValidatedOwnerWan26R2vImage(image);
        if (!owned || owned.model_id !== model || sha(owned.bytes) !== owned.sha256) fail("INVALID_REQUEST");
        semanticKey = semantic(principal, attempt, model, kind, owned.sha256);
        this.#claim(semanticKey);
        claimed = true;
        try {
          await this.#assertFresh(attempt, principal, client, operation);
          posted = true;
          const context = await client.uploadWan26R2vImage({
            model_id: model,
            filename: owned.filename,
            mime_type: owned.mime_type,
            bytes: owned.bytes
          }, operation.signal);
          this.#check(operation);
          await this.#assertFresh(attempt, principal, client, operation);
          return this.#store(attempt, model, principal, client, kind, context, operation.epoch);
        } finally {
          owned.bytes.fill(0);
        }
      }

      original = await this.#probe.probe({
        model_id: model,
        filename: fields.filename,
        mime_type: fields.mime_type,
        bytes: decoded
      }, { signal: operation.signal });
      this.#check(operation);
      await this.#assertFresh(attempt, principal, client, operation);
      const selection = validateOwnerWan26R2vVideoSelection({
        original,
        start_seconds: fields.start_seconds as number,
        end_seconds: fields.end_seconds as number,
        total_reference_count: fields.total_reference_count as number
      });
      const originalBytes = copyTrustedOwnerWan26R2vOriginalBytes(original);
      try {
        if (sha(originalBytes) !== original.source_sha256) fail("INVALID_REQUEST");
      } finally {
        originalBytes.fill(0);
      }
      semanticKey = semantic(principal, attempt, model, kind,
        `${original.source_sha256}:${selection.effective_start_frame}:${selection.effective_end_frame}`);
      this.#claim(semanticKey);
      claimed = true;
      crop = await this.#crop.crop(original, selection, { signal: operation.signal });
      this.#check(operation);
      await this.#assertFresh(attempt, principal, client, operation);
      const videoBytes = copyTrustedOwnerWan26R2vVideoCropBytes(crop);
      try {
        if (sha(videoBytes) !== crop.crop_sha256) fail("INVALID_REQUEST");
        await this.#assertFresh(attempt, principal, client, operation);
        posted = true;
        const context = await client.uploadWan26R2vSelectedVideo(crop, operation.signal);
        this.#check(operation);
        await this.#assertFresh(attempt, principal, client, operation);
        return this.#store(attempt, model, principal, client, kind, context, operation.epoch);
      } finally {
        videoBytes.fill(0);
      }
    } catch (error) {
      if (posted) {
        if (claimed && semanticKey) this.#unknownSemantic.add(semanticKey);
        void this.#revoke(attempt);
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      if (error instanceof OwnerWan26R2vReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof SyntxHttpError) fail("UPLOAD_REJECTED");
      return fail("INVALID_REQUEST");
    } finally {
      if (claimed && semanticKey) this.#pendingSemantic.delete(semanticKey);
      try {
        decoded?.fill(0);
      } catch { /* best-effort wipe; other owned resources still release */ }
      try {
        if (image) releaseValidatedOwnerWan26R2vImage(image);
      } catch { /* release all remaining owned resources */ }
      try {
        if (crop) releaseTrustedOwnerWan26R2vVideoCropReceipt(crop);
      } catch { /* release all remaining owned resources */ }
      try {
        if (original) releaseTrustedOwnerWan26R2vOriginalProbeResult(original);
      } catch { /* operation completion must not be skipped */ }
      this.#finish(attempt, operation);
    }
  }
  #store(
    attempt: string,
    model: OwnerWan26R2vModelId,
    principal: Readonly<GenerationPrincipalRef>,
    client: SyntxChatHttpClient,
    kind: RecordItem["kind"],
    context: OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext,
    epoch: number
  ): OwnerWan26R2vReferenceReceipt {
    const now = this.#time();
    this.#prune(now);
    if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    if (context.model_id !== model || context.media_type !== (kind === "image" ? "image" : "selected_video") ||
        !this.#nativeContext(client, context)) fail("UPLOAD_OUTCOME_UNKNOWN");
    const handle = `wan26ref_${randomUUID().replaceAll("-", "")}`;
    const video = kind === "selected_video" ? context as OwnerWan26R2vSelectedVideoUploadContext : undefined;
    const receipt: OwnerWan26R2vReferenceReceipt = Object.freeze({
      status: "uploaded",
      reference_handle: handle,
      model_id: model,
      media_type: kind,
      mime_type: context.mime_type,
      size: context.size,
      sha256: context.sha256,
      width: context.width,
      height: context.height,
      source_policy_id: video
        ? "OWNER_WAN26_R2V_ORIGINAL_VIDEO_POLICY_C396_LOCAL_GUARD_V1"
        : (context as OwnerWan26R2vImageUploadContext).source_policy_id,
      reference_proof: "LOCAL_VALIDATION_AND_NATIVE_UPLOAD_NOT_PROVIDER_ACCEPTANCE",
      ...(video ? {
        selection_policy_id: OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.policy_id,
        selected_duration_seconds: video.selected_duration_seconds,
        video_duration_seconds: video.video_duration_seconds,
        source_sha256: video.source_sha256
      } : {}),
      expires_in_seconds: 900,
      generation_permit: false
    });
    this.#records.set(handle, {
      handle, attempt, model, principal, client, context, receipt, kind,
      expires: now + TTL, epoch
    });
    return receipt;
  }
  #claim(key: string): void {
    this.#prune(this.#time());
    if (this.#unknownSemantic.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN");
    if (this.#pendingSemantic.has(key)) fail("SERVICE_BUSY");
    if (this.#records.size + this.#pendingSemantic.size + this.#unknownSemantic.size >= MAX_RECORDS) {
      fail("CAPACITY_EXCEEDED");
    }
    this.#pendingSemantic.add(key);
  }

  async #verify(records: RecordItem[], operation: Operation): Promise<void> {
    const client = await this.#client(operation);
    const principal = await this.#principalFor(operation);
    this.#check(operation);
    this.#assertRecordsLive(records, operation.attempt, records[0]!.model,
      principal, client, operation.epoch);
  }

  async #assertFresh(
    attempt: string,
    principal: Readonly<GenerationPrincipalRef>,
    client: SyntxChatHttpClient,
    operation: Operation
  ): Promise<void> {
    const currentClient = await this.#client(operation);
    const currentPrincipal = await this.#principalFor(operation);
    this.#check(operation);
    if (!sameGenerationPrincipal(principal, currentPrincipal) || currentClient !== client) {
      void this.#revoke(attempt);
      fail("PRINCIPAL_NOT_LINKED");
    }
  }

  async #principalFor(operation: Operation): Promise<Readonly<GenerationPrincipalRef>> {
    this.#check(operation);
    const principal = await resolveOwnerReferencePrincipal({
      binding: this.#binding,
      attemptId: operation.attempt,
      linkService: this.#links
    });
    this.#check(operation);
    const old = this.#principal.get(operation.attempt);
    if (old && !sameGenerationPrincipal(old, principal)) {
      void this.#revoke(operation.attempt);
      fail("PRINCIPAL_NOT_LINKED");
    }
    this.#principal.set(operation.attempt, principal);
    return principal;
  }

  async #client(operation: Operation): Promise<SyntxChatHttpClient> {
    this.#check(operation);
    let candidate: unknown;
    try {
      candidate = await this.#resolveClient(operation.attempt);
    } catch {
      fail("PROFILE_BINDING_MISMATCH");
    }
    this.#check(operation);
    if (types.isProxy(candidate) || !(candidate instanceof SyntxChatHttpClient) ||
        Object.hasOwn(candidate, "uploadWan26R2vImage") ||
        Object.hasOwn(candidate, "uploadWan26R2vSelectedVideo") ||
        Reflect.get(candidate, "uploadWan26R2vImage") !== NATIVE_IMAGE ||
        Reflect.get(candidate, "uploadWan26R2vSelectedVideo") !== NATIVE_VIDEO) {
      fail("PROFILE_BINDING_MISMATCH");
    }
    const old = this.#clients.get(operation.attempt);
    if (old && old !== candidate) {
      void this.#revoke(operation.attempt);
      fail("PROFILE_BINDING_MISMATCH");
    }
    this.#check(operation);
    this.#clients.set(operation.attempt, candidate);
    return candidate;
  }

  #begin(id: string, parent?: AbortSignal): Operation {
    this.#open();
    const normalizedParent = readAbortSignal(parent);
    this.#prune(this.#time());
    if (this.#invalidating.has(id)) fail("REQUEST_ABORTED");
    if (this.#work.size >= PENDING_MAX) fail("SERVICE_BUSY");
    const attempts = this.#trackedAttempts();
    if (!attempts.has(id) && attempts.size >= MAX_ATTEMPTS) {
      fail("CAPACITY_EXCEEDED");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (normalizedParent && signalAborted(normalizedParent)) abort();
    else if (normalizedParent) {
      Reflect.apply(ADD_EVENT_LISTENER, normalizedParent, ["abort", abort, { once: true }]);
    }
    let finish!: () => void;
    const promise = new Promise<void>((resolve) => { finish = resolve; });
    const operation: Operation = {
      signal: controller.signal,
      epoch: this.#epochs.get(id) ?? 0,
      attempt: id,
      controller,
      finish,
      promise,
      remove: () => {
        if (normalizedParent) Reflect.apply(REMOVE_EVENT_LISTENER, normalizedParent, ["abort", abort]);
      }
    };
    const pending = this.#pending.get(id) ?? new Set<Operation>();
    pending.add(operation);
    this.#pending.set(id, pending);
    this.#work.add(promise);
    return operation;
  }

  #finish(id: string, operation: Operation): void {
    try {
      operation.remove();
    } finally {
      const pending = this.#pending.get(id);
      pending?.delete(operation);
      if (!pending?.size) this.#pending.delete(id);
      operation.finish();
      this.#work.delete(operation.promise);
      this.#releaseAttemptIfIdle(id);
    }
  }

  #check(operation: Operation): void {
    this.#open();
    if (signalAborted(operation.signal) || operation.epoch !== (this.#epochs.get(operation.attempt) ?? 0)) {
      fail("REQUEST_ABORTED");
    }
  }

  #native(record: RecordItem): boolean {
    return this.#nativeContext(record.client, record.context);
  }

  #nativeContext(client: SyntxChatHttpClient, context: unknown): boolean {
    return !!context && typeof context === "object" &&
      (Reflect.get(context, "media_type") === "image"
        ? isOwnerWan26R2vImageUploadContextForClient(client, context)
        : !!readOwnerWan26R2vVideoUploadReferenceForClient(client, context));
  }

  #assertRecordsLive(
    records: readonly RecordItem[],
    attempt: string,
    model: OwnerWan26R2vModelId,
    principal: Readonly<GenerationPrincipalRef>,
    client: SyntxChatHttpClient,
    epoch: number
  ): void {
    const now = this.#time();
    if (!records.length || records.some((record) =>
      this.#records.get(record.handle) !== record || record.attempt !== attempt ||
      record.model !== model || record.client !== client ||
      !sameGenerationPrincipal(record.principal, principal) || record.epoch !== epoch ||
      record.expires <= now || !this.#native(record))) {
      fail("REFERENCE_UNAVAILABLE");
    }
  }

  #isLiveRecord(record: RecordItem): boolean {
    try {
      const principal = this.#principal.get(record.attempt);
      return !this.#closed && this.#records.get(record.handle) === record &&
        record.expires > this.#time() && record.epoch === (this.#epochs.get(record.attempt) ?? 0) &&
        this.#clients.get(record.attempt) === record.client &&
        !!principal && sameGenerationPrincipal(principal, record.principal) &&
        this.#native(record);
    } catch {
      return false;
    }
  }

  #videoWithinCap(record: RecordItem, totalCount: number): boolean {
    if (record.kind !== "selected_video") return true;
    const context = record.context as OwnerWan26R2vSelectedVideoUploadContext;
    return Number.isFinite(context.selected_duration_seconds) &&
      Number.isFinite(context.video_duration_seconds) &&
      context.selected_duration_seconds > 0 && context.video_duration_seconds > 0 &&
      context.selected_duration_seconds * totalCount <= 5.000001 &&
      context.video_duration_seconds * totalCount <= 5.000001;
  }

  #time(): number {
    let value: unknown;
    try {
      value = this.#now();
    } catch {
      fail("SERVICE_CLOSED");
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < this.#last ||
        value > Number.MAX_SAFE_INTEGER) fail("SERVICE_CLOSED");
    this.#last = value;
    return value;
  }

  #prune(now: number): void {
    for (const [handle, record] of this.#records) {
      if (record.expires <= now) this.#records.delete(handle);
    }
    for (const attempt of this.#trackedAttempts()) this.#releaseAttemptIfIdle(attempt);
  }

  #url(record: RecordItem): string | null {
    return record.kind === "image"
      ? readImageUrl(record.client, record.context)
      : readOwnerWan26R2vVideoUploadReferenceForClient(record.client, record.context)?.url ?? null;
  }

  #trackedAttempts(): Set<string> {
    return new Set([
      ...[...this.#records.values()].map((record) => record.attempt),
      ...this.#principal.keys(),
      ...this.#clients.keys(),
      ...this.#epochs.keys(),
      ...this.#pending.keys(),
      ...this.#invalidating
    ]);
  }

  #releaseAttemptIfIdle(id: string): void {
    const hasRecords = [...this.#records.values()].some((record) => record.attempt === id);
    if (!hasRecords && !this.#pending.has(id) && !this.#invalidating.has(id)) {
      this.#principal.delete(id);
      this.#clients.delete(id);
      this.#epochs.delete(id);
    }
  }

  #revoke(id: string): Promise<void> {
    const existing = this.#invalidations.get(id);
    if (existing) return existing;
    if (!this.#trackedAttempts().has(id)) return Promise.resolve();
    this.#invalidating.add(id);
    this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1);
    const operations = [...(this.#pending.get(id) ?? [])];
    for (const operation of operations) operation.controller.abort();
    for (const [handle, record] of this.#records) {
      if (record.attempt === id) this.#records.delete(handle);
    }
    this.#principal.delete(id);
    this.#clients.delete(id);
    let invalidation!: Promise<void>;
    invalidation = Promise.allSettled(operations.map((operation) => operation.promise)).then(() => {
      if (this.#invalidations.get(id) === invalidation) {
        this.#invalidations.delete(id);
        this.#invalidating.delete(id);
        this.#releaseAttemptIfIdle(id);
      }
    });
    this.#invalidations.set(id, invalidation);
    return invalidation;
  }

  #open(): void {
    if (this.#closed) fail("SERVICE_CLOSED");
  }
}
function normalizeInput(
  attempt_id: string,
  model_id: OwnerWan26R2vModelId,
  reference_handles: string[]
): ResolveInput {
  return Object.freeze({
    attempt_id,
    model_id,
    reference_handles: Object.freeze([...reference_handles])
  });
}

function semantic(
  principal: Readonly<GenerationPrincipalRef>,
  attempt: string,
  model: OwnerWan26R2vModelId,
  media: string,
  digest: string
): string {
  return createHash("sha256")
    .update(`${principal.tenant_id}\0${principal.subject_id}\0${attempt}\0${model}\0${media}\0${digest}`)
    .digest("hex");
}

function decode(value: string): Buffer {
  const validBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
  if (!validBase64 || !value.length) fail("INVALID_REQUEST");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    bytes.fill(0);
    fail("INVALID_REQUEST");
  }
  return bytes;
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readImageUrl(client: SyntxChatHttpClient, context: unknown): string | null {
  if (!isOwnerWan26R2vImageUploadContextForClient(client, context)) return null;
  return readOwnerWan26R2vUploadReferenceForClient(client, context)?.url ?? null;
}
function readHandleArray(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail("INVALID_REQUEST");
  }
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    return fail("INVALID_REQUEST");
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") ||
      lengthDescriptor.enumerable !== false || !Number.isSafeInteger(length) || length < 0 || length > 5) {
    return fail("INVALID_REQUEST");
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1 || keys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index >= length;
  })) return fail("INVALID_REQUEST");
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true ||
        typeof descriptor.value !== "string") return fail("INVALID_REQUEST");
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function readAbortSignal(value: AbortSignal | undefined): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== ABORT_SIGNAL_PROTO || !ABORTED_GETTER) {
    return fail("INVALID_REQUEST");
  }
  try {
    Reflect.apply(ABORTED_GETTER, value, []);
    const listener = () => undefined;
    Reflect.apply(ADD_EVENT_LISTENER, value, ["abort", listener]);
    Reflect.apply(REMOVE_EVENT_LISTENER, value, ["abort", listener]);
  } catch {
    return fail("INVALID_REQUEST");
  }
  return value;
}

function signalAborted(signal: AbortSignal): boolean {
  try {
    return Reflect.apply(ABORTED_GETTER!, signal, []) as boolean;
  } catch {
    return true;
  }
}
function exact(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    fail("INVALID_REQUEST");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = required.concat(optional);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      keys.length < required.length ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) {
    fail("INVALID_REQUEST");
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key as string]!.value]));
}

function fail(code: string): never {
  throw new OwnerWan26R2vReferenceServiceError(code);
}

interface Operation {
  readonly signal: AbortSignal;
  readonly epoch: number;
  readonly attempt: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  readonly finish: () => void;
  readonly remove: () => void;
}
