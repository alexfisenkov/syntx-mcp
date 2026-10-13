import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  OwnerSoulCatalogShapeHttpError,
  type OwnerSoulCatalogShapeHttpClient,
  type SoulCatalogShapeKind,
  type SoulCatalogShapeSummary
} from "../adapter/syntx/owner-soul-catalog-shape-http-client.js";

const MODEL_ID = "higgsfield-soul";
const MAX_PENDING = 4;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;

export type OwnerSoulCatalogShapeServiceErrorCode =
  | "INVALID_REQUEST"
  | "PRINCIPAL_NOT_LINKED"
  | "MODEL_BINDING_MISMATCH"
  | "SERVICE_BUSY"
  | "SERVICE_CLOSED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_REQUEST_ABORTED"
  | "UPSTREAM_PROTOCOL_ERROR";

export class OwnerSoulCatalogShapeServiceError extends Error {
  constructor(readonly code: OwnerSoulCatalogShapeServiceErrorCode) {
    super("The owner-scoped Soul catalog shape is unavailable.");
    this.name = "OwnerSoulCatalogShapeServiceError";
  }
}

export interface InspectOwnerSoulCatalogShapeInput {
  readonly attemptId: string;
  readonly kind: SoulCatalogShapeKind;
  readonly signal?: AbortSignal;
}

export interface OwnerSoulCatalogShapeReport extends SoulCatalogShapeSummary {
  readonly model_id: "higgsfield-soul";
  readonly catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly confidence_scope: "owner_authenticated_fixed_route_shape_only";
  readonly generation_allowed: false;
  readonly backend_acceptance: "unproven";
}

export interface OwnerSoulCatalogShapeServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly catalogVersion: string;
  readonly resolveClient: (attemptId: string) => Pick<OwnerSoulCatalogShapeHttpClient, "inspect">;
}

/** Owner-bound, read-only first-look service. It never caches list values. */
export class OwnerSoulCatalogShapeService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly #resolveClient: OwnerSoulCatalogShapeServiceOptions["resolveClient"];
  readonly #pending = new Map<string, Set<AbortController>>();
  readonly #operations = new Set<Promise<void>>();
  #pendingCount = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerSoulCatalogShapeServiceOptions) {
    if (options.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
      throw new OwnerSoulCatalogShapeServiceError("MODEL_BINDING_MISMATCH");
    }
    const model = options.catalog.getModel(MODEL_ID);
    if (model.active !== true || model.id !== MODEL_ID || model.ai_name !== MODEL_ID ||
        !model.modalities.includes("image")) {
      throw new OwnerSoulCatalogShapeServiceError("MODEL_BINDING_MISMATCH");
    }
    this.#binding = Object.freeze({
      tenant_id: options.binding.tenant_id,
      subject: options.binding.subject
    });
    this.#linkService = options.linkService;
    this.#catalog = options.catalog;
    this.#resolveClient = options.resolveClient;
  }

  async inspect(input: InspectOwnerSoulCatalogShapeInput): Promise<OwnerSoulCatalogShapeReport> {
    const snapshot = snapshotInput(input);
    if (this.#closed) throw new OwnerSoulCatalogShapeServiceError("SERVICE_CLOSED");
    if (this.#pendingCount >= MAX_PENDING) throw new OwnerSoulCatalogShapeServiceError("SERVICE_BUSY");
    const model = this.#catalog.getModel(MODEL_ID);
    if (model.active !== true || model.id !== MODEL_ID || model.ai_name !== MODEL_ID ||
        !model.modalities.includes("image")) {
      throw new OwnerSoulCatalogShapeServiceError("MODEL_BINDING_MISMATCH");
    }
    const controller = new AbortController();
    const parentSignal = snapshot.signal;
    const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) onAbort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    const controllers = this.#pending.get(snapshot.attemptId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#pending.set(snapshot.attemptId, controllers);
    this.#pendingCount += 1;
    let finishOperation!: () => void;
    const operationDone = new Promise<void>((resolve) => { finishOperation = resolve; });
    this.#operations.add(operationDone);
    try {
      const principal = await this.#resolvePrincipal(snapshot.attemptId);
      if (this.#closed || controller.signal.aborted) throw new OwnerSoulCatalogShapeServiceError("SERVICE_CLOSED");
      const result = await this.#resolveClient(snapshot.attemptId).inspect(snapshot.kind, controller.signal);
      if (this.#closed || controller.signal.aborted) throw new OwnerSoulCatalogShapeServiceError("SERVICE_CLOSED");
      const current = await this.#resolvePrincipal(snapshot.attemptId);
      if (!sameGenerationPrincipal(principal, current)) throw new OwnerSoulCatalogShapeServiceError("PRINCIPAL_NOT_LINKED");
      return Object.freeze({
        ...result,
        model_id: MODEL_ID,
        catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        confidence_scope: "owner_authenticated_fixed_route_shape_only",
        generation_allowed: false,
        backend_acceptance: "unproven"
      }) as OwnerSoulCatalogShapeReport;
    } catch (error) {
      if (error instanceof OwnerSoulCatalogShapeServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) throw new OwnerSoulCatalogShapeServiceError("PRINCIPAL_NOT_LINKED");
      if (error instanceof OwnerSoulCatalogShapeHttpError) {
        if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_OR_ACCESS_DENIED") {
          throw new OwnerSoulCatalogShapeServiceError("PRINCIPAL_NOT_LINKED");
        }
        if (error.code === "UPSTREAM_TIMEOUT") throw new OwnerSoulCatalogShapeServiceError("UPSTREAM_TIMEOUT");
        if (error.code === "UPSTREAM_REQUEST_ABORTED") throw new OwnerSoulCatalogShapeServiceError("UPSTREAM_REQUEST_ABORTED");
        if (error.code === "UPSTREAM_PROTOCOL_ERROR") throw new OwnerSoulCatalogShapeServiceError("UPSTREAM_PROTOCOL_ERROR");
      }
      if (controller.signal.aborted) throw new OwnerSoulCatalogShapeServiceError("UPSTREAM_REQUEST_ABORTED");
      throw new OwnerSoulCatalogShapeServiceError("UPSTREAM_UNAVAILABLE");
    } finally {
      parentSignal?.removeEventListener("abort", onAbort);
      controllers.delete(controller);
      if (controllers.size === 0) this.#pending.delete(snapshot.attemptId);
      this.#pendingCount -= 1;
      finishOperation();
      this.#operations.delete(operationDone);
    }
  }

  invalidateAttempt(attemptId: string): void {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    for (const controller of this.#pending.get(attemptId) ?? []) controller.abort();
    this.#pending.delete(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#pending.values()) for (const controller of controllers) controller.abort();
    this.#closing = Promise.allSettled([...this.#operations]).then(() => undefined);
    return this.#closing;
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      return await resolveOwnerReferencePrincipal({
        binding: this.#binding,
        attemptId,
        linkService: this.#linkService
      });
    } catch (error) {
      if (error instanceof OwnerSoulCatalogShapeServiceError) throw error;
      throw new OwnerSoulCatalogShapeServiceError("PRINCIPAL_NOT_LINKED");
    }
  }
}

function snapshotInput(value: unknown): { attemptId: string; kind: SoulCatalogShapeKind; signal?: AbortSignal } {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !["attemptId", "kind", "signal"].includes(key) || !("value" in descriptors[key]!)) ||
        !Object.hasOwn(descriptors, "attemptId") || !Object.hasOwn(descriptors, "kind")) throw null;
    const attemptId = descriptors.attemptId!.value;
    const kind = descriptors.kind!.value;
    const signal = descriptors.signal?.value;
    if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId) ||
        (kind !== "styles" && kind !== "characters") ||
        (signal !== undefined && (!(signal instanceof AbortSignal) || isProxy(signal)))) throw null;
    return { attemptId, kind, ...(signal === undefined ? {} : { signal }) };
  } catch {
    throw new OwnerSoulCatalogShapeServiceError("INVALID_REQUEST");
  }
}
