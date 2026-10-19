import { types } from "node:util";
import { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { AuthBinding } from "../auth/types.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SERVICES = new WeakSet<object>();
interface ActiveRead { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void }

export const OWNER_HIGGSFIELD_DOP_MOTIONS_SOURCE = Object.freeze({
  status: "SOURCE_PINNED_FRONTEND_ROUTE_AND_RESPONSE_SHAPE" as const,
  endpoint: "https://api.syntx.ai/api/v1/higgsfield/motions" as const,
  method: "GET" as const,
  source_module: "app.js" as const,
  source_sha256: "sha256:e32c91600ed5d82cac8ecad6fe7261cfaab7e43a8da3344b73c60600379f15e9" as const,
  source_bytes: 2_450_053 as const,
  axios_base_initializer_offset: 1_874_869 as const,
  axios_base_initializer_end_offset: 1_874_906 as const,
  axios_factory_start_offset: 1_870_927 as const,
  axios_factory_end_offset: 1_874_863 as const,
  api_export_offset: 2_447_249 as const,
  response_shape: "array<{id:string|number,title:string,preview_uri:string}>" as const,
  output_shape: "array<{id:string|number,label:title,strength:1}>" as const,
  preview_uri_exposed: false as const
});

export interface OwnerHiggsfieldDopMotionServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
}

export interface OwnerHiggsfieldDopMotionSelection {
  readonly id: string | number;
  readonly label: string;
  readonly strength: 1;
}

export class OwnerHiggsfieldDopMotionService {
  readonly #options: Readonly<OwnerHiggsfieldDopMotionServiceOptions>;
  readonly #active = new Map<string, Set<ActiveRead>>();
  readonly #epochs = new Map<string, number>();
  #closed = false;

  constructor(options: OwnerHiggsfieldDopMotionServiceOptions) {
    if (!options || types.isProxy(options) || !genuine(options.linkService, PerUserLinkService, ["getStatus"]) ||
        typeof options.createReadClient !== "function") throw new OwnerHiggsfieldDopMotionServiceError("INVALID_REQUEST");
    this.#options = Object.freeze({ ...options });
    SERVICES.add(this);
    Object.freeze(this);
  }

  async list(input: unknown, signal?: AbortSignal): Promise<Readonly<{ motions: readonly OwnerHiggsfieldDopMotionSelection[];
    source: typeof OWNER_HIGGSFIELD_DOP_MOTIONS_SOURCE }>> {
    const fields = exactAttempt(input);
    if (!fields || this.#closed || signal?.aborted) throw new OwnerHiggsfieldDopMotionServiceError("INVALID_REQUEST");
    const attempt = fields.attemptId, epoch = this.#epochs.get(attempt) ?? 0;
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const activeRead: ActiveRead = Object.freeze({ controller, done, finish });
    const signals = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let current = this.#active.get(attempt);
    if (!current) this.#active.set(attempt, current = new Set());
    current.add(activeRead);
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: attempt,
        linkService: this.#options.linkService });
      const client = this.#options.createReadClient(attempt);
      if (!genuine(client, SyntxHttpClient, ["listOwnerHiggsfieldDopMotions"])) throw new OwnerHiggsfieldDopMotionServiceError("READ_FAILED");
      const rows = await SyntxHttpClient.prototype.listOwnerHiggsfieldDopMotions.call(client, signals);
      const currentPrincipal = await resolveOwnerReferencePrincipal({ binding: this.#options.binding, attemptId: attempt,
        linkService: this.#options.linkService });
      if (this.#closed || signals.aborted || (this.#epochs.get(attempt) ?? 0) !== epoch ||
          !sameGenerationPrincipal(principal, currentPrincipal)) throw new OwnerHiggsfieldDopMotionServiceError("PRINCIPAL_NOT_LINKED");
      return Object.freeze({ motions: Object.freeze(rows.map(row => Object.freeze({ id: row.id, label: row.title, strength: 1 as const }))),
        source: OWNER_HIGGSFIELD_DOP_MOTIONS_SOURCE });
    } catch (error) {
      if (error instanceof OwnerHiggsfieldDopMotionServiceError) throw error;
      throw new OwnerHiggsfieldDopMotionServiceError("READ_FAILED");
    } finally {
      current.delete(activeRead);
      finish();
      if (current.size === 0) this.#active.delete(attempt);
    }
  }

  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    const active = [...(this.#active.get(attempt) ?? [])];
    for (const read of active) read.controller.abort();
    await Promise.allSettled(active.map(read => read.done));
  }

  async close(): Promise<void> {
    this.#closed = true;
    const active = [...this.#active.values()].flatMap(reads => [...reads]);
    for (const read of active) read.controller.abort();
    await Promise.allSettled(active.map(read => read.done));
    this.#active.clear();
  }
}

export class OwnerHiggsfieldDopMotionServiceError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "READ_FAILED" | "PRINCIPAL_NOT_LINKED") {
    super("The owner Higgsfield DOP motion catalogue could not be read safely.");
    this.name = "OwnerHiggsfieldDopMotionServiceError";
  }
}

export function isOwnerHiggsfieldDopMotionService(value: unknown): value is OwnerHiggsfieldDopMotionService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value);
}

function exactAttempt(value: unknown): Readonly<{ attemptId: string }> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 1 || keys[0] !== "attemptId" || !Object.hasOwn(descriptors.attemptId!, "value") ||
        descriptors.attemptId!.enumerable !== true) return null;
    const attemptId = descriptors.attemptId!.value;
    return typeof attemptId === "string" && ATTEMPT.test(attemptId) ? Object.freeze({ attemptId }) : null;
  } catch { return null; }
}

function genuine(value: unknown, constructor: Function, methods: readonly string[]): boolean {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== constructor.prototype) return false;
    return methods.every(name => !Object.hasOwn(value, name) && typeof Reflect.get(value, name) === typeof Reflect.get(constructor.prototype, name));
  } catch { return false; }
}
