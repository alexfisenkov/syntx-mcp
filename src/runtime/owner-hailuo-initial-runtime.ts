import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerHailuoInitialUploadDestination } from "../application/owner-hailuo-initial-image-vault.js";
import { OwnerHailuoInitialImageVault } from "../application/owner-hailuo-initial-image-vault.js";
import { OwnerHailuoInitialGenerationService, loadOwnerHailuoInitialRuntimeCatalog } from "../application/owner-hailuo-initial-generation-service.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;
export interface OwnerHailuoInitialRuntimeOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly catalogDirectory?: string;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly uploadDestination: OwnerHailuoInitialUploadDestination; readonly now: () => number;
}
export function createOwnerHailuoInitialRuntime(options: OwnerHailuoInitialRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function" || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden")) {
    throw new Error("OWNER_HAILUO_INITIAL_RUNTIME_CONFIGURATION_INVALID");
  }
  const runtimeCatalog = loadOwnerHailuoInitialRuntimeCatalog(options.catalogDirectory);
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attempt: string): SyntxChatHttpClient => {
    const previous = clients.get(attempt); if (previous) return previous;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_HAILUO_INITIAL_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attempt); clients.set(attempt, client); return client;
  };
  let imageVault: OwnerHailuoInitialImageVault | undefined, generationService: OwnerHailuoInitialGenerationService | undefined;
  try {
    imageVault = new OwnerHailuoInitialImageVault({ binding: options.binding, linkService: options.linkService,
      resolveChatClient, uploadDestination: options.uploadDestination, now: options.now });
    generationService = new OwnerHailuoInitialGenerationService({ binding: options.binding, linkService: options.linkService,
      imageVault, catalog: runtimeCatalog.catalog, ...(options.catalogDirectory ? { catalogDirectory: options.catalogDirectory } : {}),
      resolveChatClient, createReadClient: options.createReadClient, now: options.now });
  } catch (error) {
    const cleanup = settleOwnerHailuoInitialClosures([() => generationService?.close(), () => imageVault?.close()])
      .finally(() => { clients.clear(); });
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }
  const images = imageVault, generation = generationService;
  const invalidations = new Map<string, Promise<void>>();
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    invalidateAttempt(attempt: string): Promise<void> {
      const prior = invalidations.get(attempt); if (prior) return prior;
      const task = settleOwnerHailuoInitialClosures([() => generation.invalidateAttempt(attempt), () => images.invalidateAttempt(attempt)])
        .finally(() => { clients.delete(attempt); invalidations.delete(attempt); });
      invalidations.set(attempt, task); return task;
    },
    close(): Promise<void> {
      closing ??= settleOwnerHailuoInitialClosures([() => generation.close(), () => images.close()]).finally(() => { clients.clear(); invalidations.clear(); });
      return closing;
    }
  });
  return Object.freeze({ runtimeCatalog, imageVault: images, generationService: generation, lifecycle });
}
export function getOwnerHailuoInitialRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}
export async function settleOwnerHailuoInitialClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => { await close(); }));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner Hailuo initial cleanup was not confirmed.");
}
