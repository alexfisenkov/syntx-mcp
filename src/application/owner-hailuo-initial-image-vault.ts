import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerHailuoInitialUploadReferenceForClient, type OwnerHailuoInitialUploadContext } from "../adapter/syntx/owner-hailuo-initial-native-context.js";
import { readValidatedOwnerHailuoInitialImage, releaseValidatedOwnerHailuoInitialImage, validateOwnerHailuoInitialImage,
  type OwnerHailuoInitialImageMimeType, type ValidatedOwnerHailuoInitialImage } from "./owner-hailuo-image-policy.js";
import { isOwnerHailuoInitialModelId, type OwnerHailuoInitialModelId } from "./owner-hailuo-media-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^hailuo_initial_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const LINK_STATUS = PerUserLinkService.prototype.getStatus;

export type OwnerHailuoInitialUploadDestination = "uploaded" | "hidden";
export interface OwnerHailuoInitialImageVaultOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveChatClient: (attemptId: string) => unknown; readonly uploadDestination: OwnerHailuoInitialUploadDestination;
  readonly now?: () => number;
}
export interface OwnerHailuoInitialUploadInput {
  readonly attemptId: string; readonly model_id: OwnerHailuoInitialModelId; readonly filename: string;
  readonly mime_type: OwnerHailuoInitialImageMimeType; readonly bytes: Uint8Array;
}
export interface OwnerHailuoInitialUploadReceipt {
  readonly status: "uploaded"; readonly reference_handle: string; readonly model_id: OwnerHailuoInitialModelId;
  readonly media_type: "image"; readonly mime_type: OwnerHailuoInitialImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"; readonly provider_acceptance: "UNPROVEN";
  readonly upload_authority: false; readonly generation_permit: false;
}
export interface OwnerHailuoInitialOwnedImage {
  readonly attempt_id: string; readonly model_id: OwnerHailuoInitialModelId; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly reference: Readonly<{ reference_handle: string; mime_type: OwnerHailuoInitialImageMimeType; size: number; sha256: string;
    width: number; height: number }>; readonly expires_at: number; readonly generation_permit: false;
}
interface Entry {
  readonly handle: string; readonly attempt: string; readonly model: OwnerHailuoInitialModelId;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient; readonly epoch: number;
  readonly expires: number; readonly context: OwnerHailuoInitialUploadContext; readonly mime: OwnerHailuoInitialImageMimeType;
  readonly size: number; readonly sha256: string; readonly width: number; readonly height: number;
}
const OWNED = new WeakMap<object, Readonly<{ service: OwnerHailuoInitialImageVault; entry: Entry }>>();
const SERVICES = new WeakSet<object>();

export class OwnerHailuoInitialImageVaultError extends Error {
  constructor(readonly code: string) { super("The Hailuo initial image reference is unavailable."); this.name = "OwnerHailuoInitialImageVaultError"; }
}

/** Process-local owner-bound vault. The upload URL stays in the exact native client's WeakMap. */
export class OwnerHailuoInitialImageVault {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolve: (attemptId: string) => unknown; readonly #destination: OwnerHailuoInitialUploadDestination;
  readonly #now: () => number; readonly #entries = new Map<string, Entry>(); readonly #epochs = new Map<string, number>();
  readonly #clients = new Map<string, SyntxChatHttpClient>(); readonly #pending = new Set<Promise<unknown>>();
  #lastNow = -1; #closed = false;

  constructor(input: OwnerHailuoInitialImageVaultOptions | unknown) {
    const fields = exact(input, ["binding", "linkService", "resolveChatClient", "uploadDestination"], ["now"]);
    if (!genuineLinks(fields.linkService) || typeof fields.resolveChatClient !== "function" ||
        (fields.uploadDestination !== "uploaded" && fields.uploadDestination !== "hidden") ||
        (fields.now !== undefined && typeof fields.now !== "function") ||
        typeof SyntxChatHttpClient.prototype.uploadOwnerHailuoInitialImage !== "function") fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding); this.#links = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolve = fields.resolveChatClient as (attemptId: string) => unknown;
    this.#destination = fields.uploadDestination as OwnerHailuoInitialUploadDestination;
    this.#now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
    SERVICES.add(this); Object.freeze(this);
  }

  async uploadReference(input: OwnerHailuoInitialUploadInput | unknown, signal?: AbortSignal): Promise<OwnerHailuoInitialUploadReceipt> {
    this.#assertOpen(); const request = uploadSnapshot(input); this.#time();
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    if (this.#pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const task = this.#upload(request, combined); this.#pending.add(task);
    try { return await task; } finally { this.#pending.delete(task); }
  }

  async resolveReference(input: unknown): Promise<Readonly<OwnerHailuoInitialOwnedImage>> {
    this.#assertOpen(); const fields = exact(input, ["attemptId", "model_id", "reference_handle"]);
    if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !isOwnerHailuoInitialModelId(fields.model_id) ||
        typeof fields.reference_handle !== "string" || !HANDLE.test(fields.reference_handle)) fail("INVALID_REQUEST");
    const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: fields.attemptId, linkService: this.#links });
    const entry = this.#entries.get(fields.reference_handle);
    if (!entry || entry.attempt !== fields.attemptId || entry.model !== fields.model_id || !sameGenerationPrincipal(entry.principal, principal) ||
        entry.epoch !== (this.#epochs.get(fields.attemptId) ?? 0) || entry.expires <= this.#time() ||
        this.#resolve(fields.attemptId) !== entry.client || !readOwnerHailuoInitialUploadReferenceForClient(entry.client, entry.context)) fail("REFERENCE_UNAVAILABLE");
    const owned = Object.freeze({ attempt_id: entry.attempt, model_id: entry.model, principal, expires_at: entry.expires,
      reference: Object.freeze({ reference_handle: entry.handle, mime_type: entry.mime, size: entry.size, sha256: entry.sha256,
        width: entry.width, height: entry.height }), generation_permit: false as const });
    OWNED.set(owned, Object.freeze({ service: this, entry })); return owned;
  }

  withCapturedReference<T>(reference: OwnerHailuoInitialOwnedImage, callback: (client: SyntxChatHttpClient,
    image: Readonly<{ url: string; sha256: string; mime_type: OwnerHailuoInitialImageMimeType; width: number; height: number }>) => T): T {
    const state = reference && typeof reference === "object" && !types.isProxy(reference) ? OWNED.get(reference) : undefined;
    if (!state || state.service !== this || state.entry.model !== reference.model_id || !this.isOwnedReference(reference) ||
        typeof callback !== "function") fail("REFERENCE_UNAVAILABLE");
    const file = readOwnerHailuoInitialUploadReferenceForClient(state.entry.client, state.entry.context);
    if (!file) fail("REFERENCE_UNAVAILABLE");
    return callback(state.entry.client, Object.freeze({ url: file.url, sha256: state.entry.sha256, mime_type: state.entry.mime,
      width: state.entry.width, height: state.entry.height }));
  }

  isOwnedReference(value: unknown): value is OwnerHailuoInitialOwnedImage {
    const state = value && typeof value === "object" && !types.isProxy(value) ? OWNED.get(value) : undefined;
    if (!state || state.service !== this || this.#closed) return false;
    const entry = state.entry;
    try { return this.#entries.get(entry.handle) === entry && entry.epoch === (this.#epochs.get(entry.attempt) ?? 0) &&
      entry.expires > this.#time() && this.#resolve(entry.attempt) === entry.client &&
      readOwnerHailuoInitialUploadReferenceForClient(entry.client, entry.context) !== null; } catch { return false; }
  }

  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const [handle, entry] of this.#entries) if (entry.attempt === attempt) this.#entries.delete(handle);
    await Promise.allSettled([...this.#pending]);
  }
  async close(): Promise<void> {
    this.#closed = true; this.#entries.clear(); await Promise.allSettled([...this.#pending]); this.#clients.clear();
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  async #upload(request: UploadSnapshot, signal: AbortSignal): Promise<OwnerHailuoInitialUploadReceipt> {
    let validated: Readonly<ValidatedOwnerHailuoInitialImage> | undefined, mediaBytes: Uint8Array | undefined, invoked = false;
    try {
      if (signal.aborted) fail("REQUEST_ABORTED");
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attemptId, linkService: this.#links });
      const client = this.#resolve(request.attemptId);
      if (!isExactClient(client) || !genuine(this.#links, PerUserLinkService, ["getStatus"]) ||
          typeof this.#resolve(request.attemptId) !== "object") fail("PRINCIPAL_NOT_LINKED");
      validated = validateOwnerHailuoInitialImage({ model_id: request.model, filename: request.filename,
        mime_type: request.mime, bytes: request.bytes });
      const media = readValidatedOwnerHailuoInitialImage(validated);
      if (!media) fail("VALIDATION_REJECTED");
      mediaBytes = media.bytes;
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      invoked = true;
      const context = await client.uploadOwnerHailuoInitialImage({ media: validated, destination: this.#destination }, signal);
      if (signal.aborted || epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#resolve(request.attemptId) !== client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const reference = readOwnerHailuoInitialUploadReferenceForClient(client, context);
      const fields = context as OwnerHailuoInitialUploadContext;
      if (!reference || fields.model_id !== request.model || fields.destination !== this.#destination ||
          fields.sha256 !== media.sha256 || fields.mime_type !== media.mime_type || fields.size !== media.size ||
          fields.width !== media.width || fields.height !== media.height) fail("UPLOAD_OUTCOME_UNKNOWN");
      const now = this.#time(); if (this.#entries.size >= MAX_RECORDS || now > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CAPACITY_EXCEEDED");
      const handle = "hailuo_initial_reference_" + randomUUID(), entry: Entry = Object.freeze({ handle, attempt: request.attemptId,
        model: request.model, principal, client, epoch, expires: now + TTL_MS, context, mime: media.mime_type,
        size: media.size, sha256: media.sha256, width: media.width, height: media.height });
      this.#entries.set(handle, entry); this.#clients.set(request.attemptId, client);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: request.model, media_type: "image",
        mime_type: media.mime_type, size: media.size, sha256: media.sha256, width: media.width, height: media.height,
        expires_in_seconds: Math.floor(TTL_MS / 1000), metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
        provider_acceptance: "UNPROVEN", upload_authority: false, generation_permit: false });
    } catch (error) {
      if (error instanceof OwnerHailuoInitialImageVaultError) throw error;
      return fail(invoked ? "UPLOAD_OUTCOME_UNKNOWN" : signal.aborted ? "REQUEST_ABORTED" : "VALIDATION_REJECTED");
    } finally {
      mediaBytes?.fill(0);
      if (validated) releaseValidatedOwnerHailuoInitialImage(validated);
      request.bytes.fill(0);
    }
  }
  #time(): number {
    let value: unknown; try { value = this.#now(); } catch { return fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastNow) return fail("CLOCK_INVALID");
    this.#lastNow = value as number; return value as number;
  }
}
Object.freeze(OwnerHailuoInitialImageVault.prototype);
export function isOwnerHailuoInitialImageVault(value: unknown): value is OwnerHailuoInitialImageVault {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHailuoInitialImageVault.prototype && Object.isFrozen(value);
}

interface UploadSnapshot {
  readonly attemptId: string; readonly model: OwnerHailuoInitialModelId; readonly filename: string;
  readonly mime: OwnerHailuoInitialImageMimeType; readonly bytes: Buffer;
}
function uploadSnapshot(value: unknown): UploadSnapshot {
  const fields = exact(value, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !isOwnerHailuoInitialModelId(fields.model_id) ||
      typeof fields.filename !== "string" || !fields.filename || Buffer.byteLength(fields.filename, "utf8") > 255 ||
      /[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(fields.filename) ||
      (fields.mime_type !== "image/jpeg" && fields.mime_type !== "image/png" && fields.mime_type !== "image/webp") ||
      !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes)) fail("INVALID_REQUEST");
  return { attemptId: fields.attemptId, model: fields.model_id, filename: fields.filename,
    mime: fields.mime_type, bytes: Buffer.from(fields.bytes) };
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const row = exact(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || !row.tenant_id || typeof row.subject !== "string" || !row.subject) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject });
}
function genuineLinks(value: unknown): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    Reflect.get(value, "getStatus") === LINK_STATUS;
}
function genuine(value: unknown, constructor: { prototype: object }, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === constructor.prototype &&
    methods.every(name => Reflect.get(value, name) === Reflect.get(constructor.prototype, name));
}
function isExactClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    Reflect.get(value, "uploadOwnerHailuoInitialImage") === SyntxChatHttpClient.prototype.uploadOwnerHailuoInitialImage;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
      !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      required.some(key => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
function fail(code: string): never { throw new OwnerHailuoInitialImageVaultError(code); }
