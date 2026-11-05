import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, isOwnerSwitchxVideoNativeClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerSwitchxReferenceContext } from "../adapter/syntx/owner-switchx-reference-context.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { isCanonicalBase64 } from "./canonical-base64.js";
import { validateOwnerSwitchxReference, releaseValidatedOwnerSwitchxReference, type OwnerSwitchxReferenceRole } from "./owner-switchx-reference-policy.js";

export interface OwnerSwitchxReferenceServiceOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly ffprobePath: string;
  readonly uploadDestination: "uploaded" | "hidden"; readonly resolveChatClient: (attemptId: string) => unknown;
  readonly now: () => number;
}
export interface OwnerSwitchxReferenceUploadInput {
  readonly attemptId: string; readonly role: OwnerSwitchxReferenceRole; readonly filename: string; readonly mime_type: string; readonly content_base64: string;
}
interface Owned { readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly native: Readonly<OwnerSwitchxReferenceContext>; readonly role: OwnerSwitchxReferenceRole; readonly sha256: string; readonly expires: number; }
export class OwnerSwitchxReferenceService {
  readonly #options: OwnerSwitchxReferenceServiceOptions; readonly #rows = new Map<string, Owned>();
  readonly #active = new Map<AbortController, { attempt: string; promise: Promise<unknown> }>(); readonly #invalidating = new Set<string>();
  #closed = false; #lastNow = -1;
  constructor(options: OwnerSwitchxReferenceServiceOptions) { this.#options = options; }
  upload(input: OwnerSwitchxReferenceUploadInput | unknown, signal?: AbortSignal) {
    this.#assertOpen(); const data = exact(input, ["attemptId", "role", "filename", "mime_type", "content_base64"]);
    const request = data as unknown as OwnerSwitchxReferenceUploadInput;
    if (typeof request.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(request.attemptId) ||
        !["style_image", "image_mask", "video_mask"].includes(request.role) || typeof request.content_base64 !== "string" ||
        typeof request.filename !== "string" || typeof request.mime_type !== "string" || signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal)) ||
        this.#invalidating.has(request.attemptId) || this.#active.size >= 2 || this.#rows.size + this.#active.size >= 128) invalid();
    const controller = new AbortController(); const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const promise = this.#upload(request, combined).finally(() => this.#active.delete(controller));
    this.#active.set(controller, { attempt: request.attemptId, promise }); return promise;
  }
  async resolve(attemptId: string, handle: string, role: OwnerSwitchxReferenceRole) {
    this.#assertOpen(); const row = this.#rows.get(handle);
    if (!row || row.attemptId !== attemptId || row.role !== role || row.expires <= this.#now() || this.#invalidating.has(attemptId) ||
        !sameGenerationPrincipal(row.principal, await this.#principal(attemptId)) || this.#options.resolveChatClient(attemptId) !== row.client) invalid();
    return row;
  }
  async invalidateAttempt(attemptId: string) {
    this.#invalidating.add(attemptId); const active = [...this.#active].filter(([, value]) => value.attempt === attemptId);
    for (const [controller] of active) controller.abort(); await Promise.allSettled(active.map(([, value]) => value.promise));
    for (const [id, row] of this.#rows) if (row.attemptId === attemptId) this.#rows.delete(id); this.#invalidating.delete(attemptId);
  }
  async close() { this.#closed = true; for (const controller of this.#active.keys()) controller.abort(); await Promise.allSettled([...this.#active.values()].map(v => v.promise)); this.#rows.clear(); }
  async #upload(request: OwnerSwitchxReferenceUploadInput, signal: AbortSignal) {
    const deadline = new AbsoluteRequestDeadline(180000, signal, () => new Error("SWITCHX_REFERENCE_UPLOAD_OUTCOME_UNKNOWN"));
    let bytes: Buffer | undefined; let validated: Awaited<ReturnType<typeof validateOwnerSwitchxReference>> | undefined;
    try {
      const principal = await deadline.waitFor(this.#principal(request.attemptId));
      const maximum = request.role === "video_mask" ? 100 * 1024 * 1024 : 27_525_120, encodedMaximum = Math.ceil(maximum / 3) * 4;
      if (!isCanonicalBase64(request.content_base64, encodedMaximum)) invalid(); bytes = Buffer.from(request.content_base64, "base64");
      if (bytes.length > maximum || bytes.toString("base64") !== request.content_base64) invalid();
      validated = await deadline.waitFor(validateOwnerSwitchxReference({ role: request.role, filename: request.filename, mime_type: request.mime_type, bytes }, this.#options.ffprobePath, deadline.signal));
      const client = this.#options.resolveChatClient(request.attemptId); if (!isOwnerSwitchxVideoNativeClient(client)) invalid();
      if (!sameGenerationPrincipal(principal, await this.#principal(request.attemptId))) invalid(); deadline.throwIfAborted();
      const native = await deadline.waitFor(Reflect.apply(SyntxChatHttpClient.prototype.uploadOwnerSwitchxReference, client, [{ attempt_id: request.attemptId,
        principal, destination: this.#options.uploadDestination, reference: validated }, deadline.signal]) as Promise<OwnerSwitchxReferenceContext>);
      if (!sameGenerationPrincipal(principal, await this.#principal(request.attemptId)) || this.#invalidating.has(request.attemptId) || this.#closed) invalid();
      const now = this.#now(), handle = `switchx_reference_${randomUUID()}`;
      this.#rows.set(handle, Object.freeze({ attemptId: request.attemptId, principal, client, native, role: request.role, sha256: validated.sha256, expires: now + 15 * 60000 }));
      return Object.freeze({ reference_handle: handle, model_id: "switchx" as const, role: request.role, mime_type: validated.mime_type, bytes: validated.size,
        width: validated.width, height: validated.height, expires_at: new Date(now + 15 * 60000).toISOString(), generation_permit: false as const,
        source_confidence: "PREPARED_MASK_OR_STYLE_MEDIA_CONTAINER_VALIDATED_NOT_SEMANTIC_PIXEL_OR_PROVIDER_PROOF" as const });
    } finally { bytes?.fill(0); if (validated) releaseValidatedOwnerSwitchxReference(validated); deadline.close(); }
  }
  async #principal(attemptId: string) { return await resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId, linkService: this.#options.linkService }); }
  #now() { const now = this.#options.now(); if (!Number.isSafeInteger(now) || now < this.#lastNow) invalid(); this.#lastNow = now; return now; }
  #assertOpen() { if (this.#closed) invalid(); }
}
function exact(value: unknown, expected: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
  const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
  if (keys.length !== expected.length || keys.some(k => typeof k !== "string" || !expected.includes(k) || !Object.hasOwn(ds[k]!, "value") || !ds[k]!.enumerable)) invalid();
  return Object.fromEntries(expected.map(k => [k, ds[k]!.value]));
}
function invalid(): never { throw new Error("INVALID_SWITCHX_REFERENCE"); }
