import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { OwnerWan25T2vGenerationService } from "../application/owner-wan25-t2v-generation-service.js";
import { loadOwnerWan25T2vRuntimeCatalog } from "../application/owner-wan25-t2v-parameters.js";

const MAX_CLIENTS = 128;
const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();

export interface OwnerWan25T2vRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number;
}

/** Process-local, default-off owner T2V composition. */
export function createOwnerWan25T2vRuntime(options: OwnerWan25T2vRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function") throw new Error("OWNER_WAN25_T2V_RUNTIME_CONFIGURATION_INVALID");
  const runtimeCatalog = loadOwnerWan25T2vRuntimeCatalog(options.catalogDirectory);
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const existing = clients.get(attemptId);
    if (existing) return existing;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_WAN25_T2V_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId);
    clients.set(attemptId, client);
    return client;
  };
  let generation: OwnerWan25T2vGenerationService;
  try {
    generation = new OwnerWan25T2vGenerationService({ binding: options.binding, linkService: options.linkService,
      catalog: runtimeCatalog.catalog, resolveChatClient, createReadClient: options.createReadClient, now: options.now });
  } catch (error) {
    const cleanup = Promise.resolve().then(() => { clients.clear(); });
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }
  const invalidations = new Map<string, Promise<void>>();
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    invalidateAttempt(attemptId: string): Promise<void> {
      const previous = invalidations.get(attemptId);
      if (previous) return previous;
      const pending = generation.invalidateAttempt(attemptId).finally(() => {
        clients.delete(attemptId);
        invalidations.delete(attemptId);
      });
      invalidations.set(attemptId, pending);
      return pending;
    },
    close(): Promise<void> {
      closing ??= generation.close().finally(() => { clients.clear(); invalidations.clear(); });
      return closing;
    }
  });
  return Object.freeze({ runtimeCatalog, generationService: generation, lifecycle });
}

export function getOwnerWan25T2vRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}
