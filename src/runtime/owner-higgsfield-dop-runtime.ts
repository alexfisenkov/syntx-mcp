import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerHiggsfieldDopUploadDestination } from "../adapter/syntx/owner-higgsfield-dop-upload-context.js";
import { OwnerHiggsfieldDopReferenceService } from "../application/owner-higgsfield-dop-reference-service.js";
import { OwnerHiggsfieldDopImportService } from "../application/owner-higgsfield-dop-import-service.js";
import { OwnerHiggsfieldDopGenerationService, loadOwnerHiggsfieldDopRuntimeCatalog } from "../application/owner-higgsfield-dop-generation-service.js";
import { OwnerHiggsfieldDopMotionService } from "../application/owner-higgsfield-dop-motion-service.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;

export interface OwnerHiggsfieldDopRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly uploadDestination: OwnerHiggsfieldDopUploadDestination;
  readonly now: () => number;
}

/** Process-local DOP composition with an explicit trusted upload destination and owner lifecycle. */
export function createOwnerHiggsfieldDopRuntime(options: OwnerHiggsfieldDopRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function" || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden")) {
    throw new Error("OWNER_HIGGSFIELD_DOP_RUNTIME_CONFIGURATION_INVALID");
  }
  const runtimeCatalog = loadOwnerHiggsfieldDopRuntimeCatalog(options.catalogDirectory);
  const motionService = new OwnerHiggsfieldDopMotionService({ binding: options.binding, linkService: options.linkService,
    createReadClient: options.createReadClient });
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const prior = clients.get(attemptId); if (prior) return prior;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_HIGGSFIELD_DOP_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId); clients.set(attemptId, client); return client;
  };
  const referenceService = new OwnerHiggsfieldDopReferenceService({ binding: options.binding, linkService: options.linkService,
    resolveClient: resolveChatClient, uploadDestination: options.uploadDestination, now: options.now });
  let generationService: OwnerHiggsfieldDopGenerationService | undefined;
  try {
    generationService = new OwnerHiggsfieldDopGenerationService({ binding: options.binding, linkService: options.linkService,
      referenceService, catalog: runtimeCatalog.catalog, ...(options.catalogDirectory ? { catalogDirectory: options.catalogDirectory } : {}),
      resolveChatClient, createReadClient: options.createReadClient, now: options.now });
  } catch (error) {
    const cleanup = settleClosures([() => generationService?.close(), () => referenceService.close(), () => motionService.close()]).finally(() => clients.clear());
    cleanup.catch(() => {});
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }

  const generation = generationService;
  const invalidations = new Map<string, Promise<void>>();
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    invalidateAttempt(attemptId: string): Promise<void> {
      const prior = invalidations.get(attemptId); if (prior) return prior;
      const pending = settleClosures([
        () => generation.invalidateAttempt(attemptId),
        () => referenceService.invalidateAttempt(attemptId),
        () => motionService.invalidateAttempt(attemptId)
      ]).finally(() => { clients.delete(attemptId); invalidations.delete(attemptId); });
      invalidations.set(attemptId, pending); return pending;
    },
    close(): Promise<void> {
      closing ??= settleClosures([() => generation.close(), () => referenceService.close(), () => motionService.close()])
        .finally(() => { clients.clear(); invalidations.clear(); });
      return closing;
    }
  });

  const importService = new OwnerHiggsfieldDopImportService(referenceService);
  return Object.freeze({ runtimeCatalog, referenceService, importService, motionService, generationService: generation, lifecycle });
}

export function getOwnerHiggsfieldDopRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}

async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner Higgsfield DOP cleanup was not confirmed.");
}
