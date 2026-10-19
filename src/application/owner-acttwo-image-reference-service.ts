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
import { readOwnerActTwoCharacterImageReference, type OwnerActTwoCharacterImageUploadContext,
  type OwnerActTwoUploadDestination } from "../adapter/syntx/owner-acttwo-image-context.js";
import { readValidatedOwnerActTwoCharacterImage,
  releaseValidatedOwnerActTwoCharacterImage, validateOwnerActTwoCharacterImage,
  type OwnerActTwoCharacterImageMimeType, type ValidatedOwnerActTwoCharacterImage } from "./owner-acttwo-image-policy.js";
import { getOwnerActTwoSourceProfile } from "./owner-acttwo-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^acttwo_character_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerActTwoCharacterImage");
const REFERENCES = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export interface OwnerActTwoImageReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly uploadDestination: OwnerActTwoUploadDestination;
  readonly now?: () => number;
}
export interface OwnerActTwoCharacterImageUploadInput {
  readonly attemptId: string;
  readonly filename: string;
  readonly mime_type: OwnerActTwoCharacterImageMimeType;
  readonly bytes: Uint8Array;
}
export interface OwnerActTwoCharacterImageReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: "acttwo";
  readonly media_type: "image";
  readonly mime_type: OwnerActTwoCharacterImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "STRUCTURAL_IMAGE_METADATA_NOT_DECODED_PIXELS";
  readonly upload_authority: false;
  readonly generation_permit: false;
}
export interface OwnerActTwoOwnedCharacterImage {
  readonly attempt_id: string;
  readonly model_id: "acttwo";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly character_image: Readonly<{
    reference_handle: string; mime_type: OwnerActTwoCharacterImageMimeType; size: number; sha256: string; width: number; height: number;
  }>;
  readonly generation_permit: false;
}
export type OwnerActTwoImageReferenceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" |
  "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "VALIDATION_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "REFERENCE_ALREADY_ATTACHED";
export class OwnerActTwoImageReferenceError extends Error {
  constructor(readonly code: OwnerActTwoImageReferenceErrorCode) {
    super("The owner ActTwo character-image reference is unavailable.");
    this.name = "OwnerActTwoImageReferenceError";
  }
}

interface Entry {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly context: OwnerActTwoCharacterImageUploadContext;
  readonly epoch: number; readonly expiresAt: number;
}
interface Pending { readonly controller: AbortController; readonly signal: AbortSignal; readonly done: Promise<void>; readonly finish: () => void }
interface OwnedState {
  readonly service: OwnerActTwoImageReferenceService; readonly entry: Entry; readonly client: SyntxChatHttpClient;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attemptId: string; readonly expiresAt: number; readonly epoch: number;
}
interface UploadSnapshot { readonly attemptId: string; readonly filename: string; readonly mimeType: OwnerActTwoCharacterImageMimeType; readonly bytes: Buffer }
interface ResolveSnapshot { readonly attemptId: string; readonly referenceHandle: string }

/** Process-local, owner-bound image vault. Upload authority and generation permits are kept separate. */
export class OwnerActTwoImageReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #destination: OwnerActTwoUploadDestination;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();
  readonly #byAttempt = new Map<string, string>();
  readonly #epochs = new Map<string, number>();
  readonly #pending = new Map<string, Pending>();
  readonly #unknown = new Set<string>();
  #lastTime = -1; #closed = false; #closing: Promise<void> | undefined;

  constructor(options: OwnerActTwoImageReferenceServiceOptions) {
    if (!options || types.isProxy(options) || !genuineLinks(options.linkService) || typeof options.resolveClient !== "function" ||
        types.isProxy(options.resolveClient) || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden") ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now))) || typeof NATIVE_UPLOAD !== "function") fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }); this.#links = options.linkService; this.#resolveClient = options.resolveClient;
    this.#destination = options.uploadDestination; this.#now = options.now ?? Date.now; SERVICES.add(this); Object.freeze(this);
  }

  async uploadCharacterImage(input: unknown, signalInput?: AbortSignal): Promise<OwnerActTwoCharacterImageReceipt> {
    this.#assertOpen(); const request = snapshotUpload(input), signal = exactSignal(signalInput);
    let validated: Readonly<ValidatedOwnerActTwoCharacterImage> | undefined;
    let semantic = "", invoked = false;
    const pending = this.#begin(request.attemptId, signal);
    try {
      const principal = await this.#principal(request.attemptId);
      this.#stopped(pending);
      const client = clientSnapshot(this.#resolveClient(request.attemptId));
      try { validated = validateOwnerActTwoCharacterImage({ model_id: "acttwo", filename: request.filename, mime_type: request.mimeType, bytes: request.bytes }); }
      catch { this.#stopped(pending); fail("VALIDATION_REJECTED"); }
      const local = readValidatedOwnerActTwoCharacterImage(validated);
      if (!local) fail("VALIDATION_REJECTED");
      const metadata = Object.freeze({ model_id: local.model_id, filename: local.filename, mime_type: local.mime_type,
        size: local.size, sha256: local.sha256, width: local.width, height: local.height });
      local.bytes.fill(0);
      semantic = schemaHash({ tenant: principal.tenant_id, subject: principal.subject_id, model_id: "acttwo", role: "character_image",
        sha256: metadata.sha256, size: metadata.size, mime_type: metadata.mime_type });
      if (this.#unknown.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#prune(this.#time());
      const oldHandle = this.#byAttempt.get(request.attemptId);
      if (oldHandle && this.#entries.has(oldHandle)) fail("REFERENCE_ALREADY_ATTACHED");
      if (this.#entries.size + this.#unknown.size >= MAX_ENTRIES) fail("CAPACITY_EXCEEDED");
      const epoch = this.#epochs.get(request.attemptId) ?? 0, expiresAt = this.#time() + TTL_MS;
      this.#stopped(pending);
      invoked = true;
      let context: OwnerActTwoCharacterImageUploadContext;
      try {
        context = await SyntxChatHttpClient.prototype.uploadOwnerActTwoCharacterImage.call(client,
          { media: validated, destination: this.#destination }, pending.signal);
      } catch { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const reference = readOwnerActTwoCharacterImageReference(client, context);
      if (!reference || reference.type !== "image" || !isSafeUploadReferenceUrl(reference.url) || context.model_id !== "acttwo" ||
          context.destination !== this.#destination || context.mime_type !== metadata.mime_type || context.size !== metadata.size ||
          context.sha256 !== metadata.sha256 || context.width !== metadata.width || context.height !== metadata.height) {
        this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const current = await this.#principal(request.attemptId);
      if (!sameGenerationPrincipal(principal, current) || clientSnapshot(this.#resolveClient(request.attemptId)) !== client ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const now = this.#time(); if (expiresAt - now < 1_000) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const handle = `acttwo_character_image_${randomUUID()}`;
      const entry = Object.freeze({ handle, attemptId: request.attemptId, principal, client, context, epoch, expiresAt });
      this.#entries.set(handle, entry); this.#byAttempt.set(request.attemptId, handle);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: "acttwo", media_type: "image",
        mime_type: metadata.mime_type, size: metadata.size, sha256: metadata.sha256, width: metadata.width, height: metadata.height,
        expires_in_seconds: Math.floor((expiresAt - now) / 1000), metadata_confidence: "STRUCTURAL_IMAGE_METADATA_NOT_DECODED_PIXELS",
        upload_authority: false, generation_permit: false });
    } catch (error) {
      if (invoked && semantic) this.#unknown.add(semantic);
      if (error instanceof OwnerActTwoImageReferenceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("VALIDATION_REJECTED");
    } finally {
      if (validated) releaseValidatedOwnerActTwoCharacterImage(validated);
      request.bytes.fill(0); this.#finish(request.attemptId, pending);
    }
  }

  async resolveCharacterImage(input: unknown, signalInput?: AbortSignal): Promise<OwnerActTwoOwnedCharacterImage> {
    this.#assertOpen(); const request = exactResolve(input), signal = exactSignal(signalInput);
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const principal = await this.#principal(request.attemptId);
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const entry = this.#entries.get(request.referenceHandle);
    if (!entry || entry.attemptId !== request.attemptId || !sameGenerationPrincipal(entry.principal, principal)) fail("REFERENCE_UNAVAILABLE");
    const now = this.#time(); if (entry.expiresAt <= now) { this.#drop(entry); fail("REFERENCE_EXPIRED"); }
    if (entry.epoch !== (this.#epochs.get(entry.attemptId) ?? 0) || clientSnapshot(this.#resolveClient(entry.attemptId)) !== entry.client) fail("REFERENCE_UNAVAILABLE");
    const reference = readOwnerActTwoCharacterImageReference(entry.client, entry.context);
    if (!reference || reference.type !== "image") fail("REFERENCE_UNAVAILABLE");
    const current = await this.#principal(request.attemptId);
    if (!sameGenerationPrincipal(principal, current) || entry.expiresAt <= this.#time()) fail("REFERENCE_EXPIRED");
    const context = entry.context;
    const owned = Object.freeze({ attempt_id: request.attemptId, model_id: "acttwo" as const, principal,
      profile_sha256: getOwnerActTwoSourceProfile().source_sha256, expires_at: entry.expiresAt, epoch: entry.epoch,
      character_image: Object.freeze({ reference_handle: entry.handle, mime_type: context.mime_type, size: context.size,
        sha256: context.sha256, width: context.width, height: context.height }), generation_permit: false as const });
    REFERENCES.set(owned, Object.freeze({ service: this, entry, client: entry.client, principal, attemptId: request.attemptId,
      expiresAt: entry.expiresAt, epoch: entry.epoch }));
    return owned;
  }

  withCapturedCharacterImage<T>(ownedInput: unknown, consume: (client: SyntxChatHttpClient, image: Readonly<{
    url: string; sha256: string; size: number; width: number; height: number; mime_type: OwnerActTwoCharacterImageMimeType;
  }>) => T): T {
    if (!this.isOwnedCharacterImage(ownedInput) || typeof consume !== "function" || types.isProxy(consume)) fail("REFERENCE_UNAVAILABLE");
    const state = REFERENCES.get(ownedInput as object)!;
    const reference = readOwnerActTwoCharacterImageReference(state.client, state.entry.context);
    if (!reference) fail("REFERENCE_UNAVAILABLE");
    const context = state.entry.context;
    return consume(state.client, Object.freeze({ url: reference.url, sha256: context.sha256, size: context.size,
      width: context.width, height: context.height, mime_type: context.mime_type }));
  }

  isOwnedCharacterImage(value: unknown): value is OwnerActTwoOwnedCharacterImage {
    try {
      if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const state = REFERENCES.get(value); if (!state || state.service !== this || this.#entries.get(state.entry.handle) !== state.entry ||
          state.attemptId !== state.entry.attemptId || state.expiresAt <= this.#time() || state.epoch !== (this.#epochs.get(state.attemptId) ?? 0) ||
          clientSnapshot(this.#resolveClient(state.attemptId)) !== state.client) return false;
      return readOwnerActTwoCharacterImageReference(state.client, state.entry.context) !== null;
    } catch { return false; }
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT.test(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    const pending = this.#pending.get(attemptId); pending?.controller.abort();
    if (pending) await pending.done;
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
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (this.#pending.has(attemptId) || this.#pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(); let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const pending = Object.freeze({ controller, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, done, finish });
    this.#pending.set(attemptId, pending);
    return pending;
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
  #time(): number { const now = this.#now(); if (!Number.isSafeInteger(now) || now < this.#lastTime) fail("INVALID_REQUEST"); this.#lastTime = now; return now; }
}

export function isOwnerActTwoImageReferenceService(value: unknown): value is OwnerActTwoImageReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerActTwoImageReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(input: unknown): UploadSnapshot {
  const fields = exact(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.filename !== "string" ||
      (fields.mime_type !== "image/jpeg" && fields.mime_type !== "image/png") || !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, filename: fields.filename, mimeType: fields.mime_type, bytes: copyBytes(fields.bytes) });
}
function copyBytes(value: Uint8Array): Buffer {
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) || ["buffer", "byteOffset", "byteLength", "length"].some(key => Object.hasOwn(value, key)) ||
        !BUFFER_GETTER || !OFFSET_GETTER || !LENGTH_GETTER || !ARRAY_BUFFER_LENGTH_GETTER) fail("INVALID_REQUEST");
    const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer, offset = Reflect.apply(OFFSET_GETTER, value, []) as number,
      length = Reflect.apply(LENGTH_GETTER, value, []) as number, backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > 20 * 1024 * 1024 || offset + length > backingLength) fail("INVALID_REQUEST");
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
      Object.hasOwn(value, "uploadOwnerActTwoCharacterImage") || typeof NATIVE_UPLOAD !== "function" ||
      Reflect.get(value, "uploadOwnerActTwoCharacterImage") !== NATIVE_UPLOAD) fail("PRINCIPAL_NOT_LINKED");
  return value as SyntxChatHttpClient;
}
function genuineLinks(value: unknown): value is Pick<PerUserLinkService, "getStatus"> {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; }
}
function exactSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined; if (!(value instanceof AbortSignal) || types.isProxy(value)) fail("INVALID_REQUEST"); return value;
}
function fail(code: OwnerActTwoImageReferenceErrorCode): never { throw new OwnerActTwoImageReferenceError(code); }
