import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { OwnerRunwayI2vReferenceService } from "../application/owner-runway-i2v-reference-service.js";
import { OwnerRunwayI2vGenerationService } from "../application/owner-runway-i2v-generation-service.js";
import { loadOwnerRunwayI2vRuntimeCatalog } from "../application/owner-runway-i2v-cost.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;

export interface OwnerRunwayI2vRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number;
}

/** Process-local owner Runway Gen4 I2V composition: fixed reference vault, client map, and recovery service. */
export function createOwnerRunwayI2vRuntime(options: OwnerRunwayI2vRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function") throw new Error("OWNER_RUNWAY_I2V_RUNTIME_CONFIGURATION_INVALID");
  const runtimeCatalog = loadOwnerRunwayI2vRuntimeCatalog(options.catalogDirectory);
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const prior = clients.get(attemptId);
    if (prior) return prior;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_RUNWAY_I2V_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId);
    clients.set(attemptId, client);
    return client;
  };
  const referenceService = new OwnerRunwayI2vReferenceService({ binding: options.binding, linkService: options.linkService,
    resolveClient: resolveChatClient, now: options.now });
  let generationService: OwnerRunwayI2vGenerationService | undefined;
  try {
    generationService = new OwnerRunwayI2vGenerationService({ binding: options.binding, linkService: options.linkService,
      referenceService, catalog: runtimeCatalog.catalog, resolveChatClient, createReadClient: options.createReadClient, now: options.now });
  } catch (error) {
    const cleanup = settleClosures([() => generationService?.close(), () => referenceService.close()])
      .finally(() => clients.clear());
    cleanup.catch(() => {});
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }

  const generation = generationService;
  const invalidations = new Map<string, Promise<void>>();
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    invalidateAttempt(attemptId: string): Promise<void> {
      const prior = invalidations.get(attemptId);
      if (prior) return prior;
      const pending = settleClosures([() => generation.invalidateAttempt(attemptId), () => referenceService.invalidateAttempt(attemptId)])
        .finally(() => { clients.delete(attemptId); invalidations.delete(attemptId); });
      invalidations.set(attemptId, pending);
      return pending;
    },
    close(): Promise<void> {
      closing ??= settleClosures([() => generation.close(), () => referenceService.close()])
        .finally(() => { clients.clear(); invalidations.clear(); });
      return closing;
    }
  });

  return Object.freeze({ runtimeCatalog, referenceService, generationService: generation, lifecycle });
}

export function getOwnerRunwayI2vRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}

async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner Runway I2V cleanup was not confirmed.");
}
