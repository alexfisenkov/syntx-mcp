import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { createOwnerHeygen4AudioProbe, releaseValidatedOwnerHeygen4Audio, releaseValidatedOwnerHeygen4Image,
  validateOwnerHeygen4Image,
  type ValidatedOwnerHeygen4Audio, type ValidatedOwnerHeygen4Image } from "./owner-heygen4-media-policy.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^heygen4_(?:image|audio)_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const SERVICES = new WeakSet<object>();

export interface OwnerHeygen4ReferenceServiceOptions { readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown; readonly ffprobePath: string; readonly now?: () => number; }
export interface OwnerHeygen4ImportInput { readonly attemptId: string; readonly file_id: string; readonly media_type: "image" | "audio";
  readonly filename: string; readonly mime_type: string; readonly bytes: Uint8Array; }
export interface OwnerHeygen4ImportReceipt { readonly status: "imported"; readonly reference_handle: string; readonly model_id: "heygen4";
  readonly media_type: "image" | "audio"; readonly file_id: string; readonly filename: string; readonly mime_type: string;
  readonly size: number; readonly sha256: string; readonly width?: number; readonly height?: number; readonly duration_seconds?: number;
  readonly expires_in_seconds: number; readonly provenance: "OWNED_EXISTING_ACCOUNT_ASSET"; readonly generation_permit: false;
  readonly provider_acceptance: "UNPROVEN"; }
export interface OwnerHeygen4OwnedReference { readonly handle: string; readonly attemptId: string; readonly media_type: "image" | "audio";
  readonly file_id: string; readonly filename: string; readonly mime_type: string; readonly sha256: string; readonly size: number;
  readonly width?: number; readonly height?: number; readonly duration_seconds?: number;
  readonly context: object; readonly client: SyntxChatHttpClient; readonly principal: Readonly<GenerationPrincipalRef>; readonly expires_at: number; }
export class OwnerHeygen4ReferenceServiceError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "ASSET_INVALID" | "SOURCE_FILE_UNAVAILABLE" |
    "SOURCE_ASSET_UNVERIFIED" | "REFERENCE_NOT_FOUND" | "REFERENCE_EXPIRED" | "SERVICE_CLOSED") {
    super("The selected existing HeyGen 4 image or audio is unavailable."); this.name = "OwnerHeygen4ReferenceServiceError";
  }
}

/** Process-local, read-only account media import. URLs remain inside the native client context. */
export class OwnerHeygen4ReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown; readonly #audioProbe: ReturnType<typeof createOwnerHeygen4AudioProbe>;
  readonly #now: () => number; readonly #records = new Map<string, OwnerHeygen4OwnedReference>(); #closed = false;
  constructor(options: OwnerHeygen4ReferenceServiceOptions | unknown) {
    const row = exact(options, ["binding", "linkService", "resolveClient", "ffprobePath"], ["now"]);
    if (!row.linkService || typeof row.linkService !== "object" || types.isProxy(row.linkService) ||
        typeof row.resolveClient !== "function" || types.isProxy(row.resolveClient) || typeof row.ffprobePath !== "string" ||
        !row.ffprobePath.startsWith("/") || row.ffprobePath.includes("\0") ||
        (row.now !== undefined && (typeof row.now !== "function" || types.isProxy(row.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(row.binding); this.#links = row.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = row.resolveClient as (attemptId: string) => unknown; this.#audioProbe = createOwnerHeygen4AudioProbe(row.ffprobePath as string);
    this.#now = row.now as (() => number) | undefined ?? Date.now; SERVICES.add(this); Object.freeze(this);
  }

  async importExisting(input: OwnerHeygen4ImportInput | unknown, signal?: AbortSignal): Promise<OwnerHeygen4ImportReceipt> {
    if (this.#closed) fail("SERVICE_CLOSED"); const request = snapshotImport(input);
    let validated: Readonly<ValidatedOwnerHeygen4Image | ValidatedOwnerHeygen4Audio> | undefined;
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attemptId, linkService: this.#links });
      const client = readClient(this.#resolveClient(request.attemptId));
      try {
        validated = request.media_type === "image"
          ? validateOwnerHeygen4Image({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes })
          : await this.#audioProbe.validate({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes }, signal);
      } catch { fail("ASSET_INVALID"); }
      const importContext = await client.importOwnerHeygen4Asset({ media: validated, file_id: request.file_id, media_type: request.media_type }, signal);
      const after = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attemptId, linkService: this.#links });
      if (!sameGenerationPrincipal(principal, after) || readClient(this.#resolveClient(request.attemptId)) !== client) fail("PRINCIPAL_NOT_LINKED");
      const handle = `heygen4_${request.media_type}_${randomUUID()}`;
      const expires = safeNow(this.#now) + TTL_MS;
      const reference: OwnerHeygen4OwnedReference = Object.freeze({ handle, attemptId: request.attemptId, media_type: request.media_type,
        file_id: request.file_id, filename: validated.filename, mime_type: validated.mime_type, sha256: validated.sha256, size: validated.size,
        ...(request.media_type === "image" ? { width: (validated as ValidatedOwnerHeygen4Image).width, height: (validated as ValidatedOwnerHeygen4Image).height } : {}),
        ...(request.media_type === "image" ? { } : { duration_seconds: (validated as ValidatedOwnerHeygen4Audio).duration_seconds }),
        context: importContext, client, principal, expires_at: expires });
      this.#records.set(handle, reference); return this.#receipt(reference, validated);
    } catch (error) {
      if (error instanceof OwnerHeygen4ReferenceServiceError) throw error;
      return fail("SOURCE_ASSET_UNVERIFIED");
    } finally {
      request.bytes.fill(0);
      if (validated) { releaseValidatedOwnerHeygen4Image(validated); releaseValidatedOwnerHeygen4Audio(validated); }
    }
  }

  resolvePair(input: unknown): Readonly<{ image: OwnerHeygen4OwnedReference; audio: OwnerHeygen4OwnedReference }> {
    if (this.#closed) fail("SERVICE_CLOSED"); const row = exact(input, ["attemptId", "image_handle", "audio_handle"]);
    if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId) || typeof row.image_handle !== "string" ||
        !HANDLE.test(row.image_handle) || typeof row.audio_handle !== "string" || !HANDLE.test(row.audio_handle)) fail("INVALID_REQUEST");
    this.#prune(); const image = this.#records.get(row.image_handle), audio = this.#records.get(row.audio_handle);
    if (!image || !audio || image.attemptId !== row.attemptId || audio.attemptId !== row.attemptId ||
        image.media_type !== "image" || audio.media_type !== "audio") fail("REFERENCE_NOT_FOUND");
    return Object.freeze({ image, audio });
  }
  isOwned(value: unknown): value is OwnerHeygen4OwnedReference { return !!value && typeof value === "object" && this.#records.get((value as OwnerHeygen4OwnedReference).handle) === value; }
  list(input: unknown): readonly OwnerHeygen4ImportReceipt[] {
    const row = exact(input, ["attemptId"]); if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId)) fail("INVALID_REQUEST");
    this.#prune(); return Object.freeze([...this.#records.values()].filter(item => item.attemptId === row.attemptId).map(item =>
      Object.freeze({ status: "imported" as const, reference_handle: item.handle, model_id: "heygen4" as const,
        media_type: item.media_type, file_id: item.file_id, filename: item.filename, mime_type: item.mime_type, size: item.size, sha256: item.sha256,
        ...(item.width === undefined ? {} : { width: item.width, height: item.height }),
        ...(item.duration_seconds === undefined ? {} : { duration_seconds: item.duration_seconds }), expires_in_seconds: Math.max(0, Math.floor((item.expires_at - safeNow(this.#now)) / 1000)),
        provenance: "OWNED_EXISTING_ACCOUNT_ASSET" as const, generation_permit: false as const, provider_acceptance: "UNPROVEN" as const })));
  }
  invalidateAttempt(attemptId: string): void { for (const [key, item] of this.#records) if (item.attemptId === attemptId) this.#records.delete(key); }
  async close(): Promise<void> { this.#closed = true; this.#records.clear(); }
  #receipt(reference: OwnerHeygen4OwnedReference, media: Readonly<ValidatedOwnerHeygen4Image | ValidatedOwnerHeygen4Audio>): OwnerHeygen4ImportReceipt {
    return Object.freeze({ status: "imported", reference_handle: reference.handle, model_id: "heygen4", media_type: reference.media_type,
      file_id: reference.file_id, filename: media.filename, mime_type: media.mime_type, size: media.size, sha256: media.sha256,
      ...(reference.media_type === "image" ? { width: (media as ValidatedOwnerHeygen4Image).width, height: (media as ValidatedOwnerHeygen4Image).height }
        : { duration_seconds: (media as ValidatedOwnerHeygen4Audio).duration_seconds }),
      expires_in_seconds: Math.floor(TTL_MS / 1000), provenance: "OWNED_EXISTING_ACCOUNT_ASSET", generation_permit: false, provider_acceptance: "UNPROVEN" });
  }
  #prune(): void { const now = safeNow(this.#now); for (const [key, row] of this.#records) if (row.expires_at <= now) this.#records.delete(key); }
}
Object.freeze(OwnerHeygen4ReferenceService.prototype);
export function isOwnerHeygen4ReferenceService(value: unknown): value is OwnerHeygen4ReferenceService { return !!value && typeof value === "object" &&
  !types.isProxy(value) && SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerHeygen4ReferenceService.prototype && Object.isFrozen(value); }

function snapshotImport(value: unknown): { attemptId: string; file_id: string; media_type: "image" | "audio"; filename: string; mime_type: string; bytes: Buffer } {
  const row = exact(value, ["attemptId", "file_id", "media_type", "filename", "mime_type", "bytes"]);
  if (typeof row.attemptId !== "string" || !ATTEMPT.test(row.attemptId) || typeof row.file_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(row.file_id) || (row.media_type !== "image" && row.media_type !== "audio") ||
      typeof row.filename !== "string" || typeof row.mime_type !== "string" || !(row.bytes instanceof Uint8Array) || types.isProxy(row.bytes)) fail("INVALID_REQUEST");
  const bytes = Buffer.from(row.bytes); if (!bytes.length || bytes.length > 10 * 1024 * 1024) { bytes.fill(0); fail("INVALID_REQUEST"); }
  return { attemptId: row.attemptId, file_id: row.file_id, media_type: row.media_type, filename: row.filename, mime_type: row.mime_type, bytes };
}
function readClient(value: unknown): SyntxChatHttpClient { if (!value || typeof value !== "object" || types.isProxy(value) ||
  Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || typeof Reflect.get(value, "importOwnerHeygen4Asset") !== "function") fail("SOURCE_FILE_UNAVAILABLE");
  return value as SyntxChatHttpClient; }
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const row = exact(value, ["tenant_id", "subject"]);
  if (typeof row.tenant_id !== "string" || !row.tenant_id || typeof row.subject !== "string" || !row.subject) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: row.tenant_id, subject: row.subject }); }
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail("INVALID_REQUEST"); }
  const actual = Reflect.ownKeys(descriptors); if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    keys.some(key => !Object.hasOwn(descriptors, key)) || actual.some(key => typeof key !== "string" || (!keys.includes(key) && !optional.includes(key)) ||
      !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>; for (const key of actual as string[]) result[key] = descriptors[key]!.value; return result;
}
function safeNow(clock: () => number): number { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail("SERVICE_CLOSED"); return value; }
function fail(code: OwnerHeygen4ReferenceServiceError["code"]): never { throw new OwnerHeygen4ReferenceServiceError(code); }
