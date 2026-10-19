import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerGrokI2vUploadDestination } from "../adapter/syntx/owner-grok-i2v-upload-context.js";
import { OwnerGrokI2vReferenceService } from "../application/owner-grok-i2v-reference-service.js";
import { OwnerGrokI2vGenerationService } from "../application/owner-grok-i2v-generation-service.js";
import { loadOwnerGrokI2vRuntimeCatalog } from "../application/owner-grok-i2v-cost.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;

export interface OwnerGrokI2vRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly uploadDestination: OwnerGrokI2vUploadDestination;
  readonly now: () => number;
}

/** Process-local Grok I2V composition: explicit destination, owner-bound image vault, and recovery service. */
export function createOwnerGrokI2vRuntime(options: OwnerGrokI2vRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function" || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden")) {
    throw new Error("OWNER_GROK_I2V_RUNTIME_CONFIGURATION_INVALID");
  }
  const runtimeCatalog = loadOwnerGrokI2vRuntimeCatalog(options.catalogDirectory);
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const prior = clients.get(attemptId);
    if (prior) return prior;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_GROK_I2V_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId);
    clients.set(attemptId, client);
    return client;
  };
  const referenceService = new OwnerGrokI2vReferenceService({ binding: options.binding, linkService: options.linkService,
    resolveClient: resolveChatClient, uploadDestination: options.uploadDestination, now: options.now });
  let generationService: OwnerGrokI2vGenerationService | undefined;
  try {
    generationService = new OwnerGrokI2vGenerationService({ binding: options.binding, linkService: options.linkService,
      referenceService, catalog: runtimeCatalog.catalog, resolveChatClient, createReadClient: options.createReadClient, now: options.now });
  } catch (error) {
    const cleanup = settleClosures([() => generationService?.close(), () => referenceService.close()]).finally(() => clients.clear());
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
      const pending = settleClosures([
        () => generation.invalidateAttempt(attemptId),
        () => referenceService.invalidateAttempt(attemptId)
      ]).finally(() => { clients.delete(attemptId); invalidations.delete(attemptId); });
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

export function getOwnerGrokI2vRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}

async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner Grok I2V cleanup was not confirmed.");
}
