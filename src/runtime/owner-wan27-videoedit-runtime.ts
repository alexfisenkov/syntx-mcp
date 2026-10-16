import { isAbsolute, resolve } from "node:path";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { AccountStatusService } from "../application/account-status.js";
import { ModelAccessService } from "../application/model-access.js";
import { getOwnerWan27VideoEditSourceProfile } from "../application/owner-wan27-videoedit-parameters.js";
import { OwnerWan27VideoEditReferenceService } from "../application/owner-wan27-videoedit-reference-service.js";
import { createOwnerWan27VideoEditRequestPreparer } from "../application/owner-wan27-videoedit-request-preparer.js";
import { OwnerWan27VideoEditGenerationService } from "../application/owner-wan27-videoedit-generation-service.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
export interface OwnerWan27VideoEditRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly ffprobePath: string;
  readonly maxVideoFileBytes?: number;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number;
}

/** Exact owner-local WAN 2.7 Video Edit composition, isolated from all other WAN brands. */
export function createOwnerWan27VideoEditRuntime(options: OwnerWan27VideoEditRuntimeOptions) {
  const maxVideoFileBytes = options.maxVideoFileBytes ?? 64 * 1024 * 1024;
  if (typeof options.ffprobePath !== "string" || !options.ffprobePath || options.ffprobePath !== options.ffprobePath.trim() ||
      options.ffprobePath.includes("\0") || !isAbsolute(options.ffprobePath) || resolve(options.ffprobePath) !== options.ffprobePath ||
      !Number.isSafeInteger(maxVideoFileBytes) || maxVideoFileBytes < 1 || maxVideoFileBytes > 100 * 1024 * 1024) {
    throw new Error("OWNER_WAN27_VIDEOEDIT_OPERATOR_CONFIGURATION_REQUIRED");
  }
  const catalogVersion = getOwnerWan27VideoEditSourceProfile().source_pins.public_catalog_version;
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(catalogVersion, options.catalogDirectory));
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveClient = (attemptId: string) => {
    const prior = clients.get(attemptId);
    if (prior) return prior;
    if (clients.size >= 128) throw new Error("OWNER_WAN27_VIDEOEDIT_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId); clients.set(attemptId, client); return client;
  };
  const referenceService = new OwnerWan27VideoEditReferenceService({ binding: options.binding, linkService: options.linkService,
    resolveClient, ffprobePath: options.ffprobePath, maxVideoFileBytes, now: options.now });
  let preparer: ReturnType<typeof createOwnerWan27VideoEditRequestPreparer> | undefined;
  let generationService: OwnerWan27VideoEditGenerationService | undefined;
  try {
    preparer = createOwnerWan27VideoEditRequestPreparer({ referenceService, now: options.now });
    generationService = new OwnerWan27VideoEditGenerationService({ binding: options.binding, linkService: options.linkService,
      catalog, catalog_version: catalogVersion, preparer, referenceService, resolveChatClient: resolveClient,
      createAccountStatusService: (attemptId: string) => new AccountStatusService(options.createReadClient(attemptId), options.now),
      createModelAccessService: (attemptId: string) => new ModelAccessService(catalog, options.createReadClient(attemptId), options.now),
      resolveSubscription: (attemptId: string, signal?: AbortSignal) => options.createReadClient(attemptId).getSubscription(signal), now: options.now });
  } catch (error) {
    const cleanup = settleClosures([() => generationService?.close(), () => preparer?.close(), () => referenceService.close()])
      .finally(() => clients.clear());
    cleanup.catch(() => {});
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }
  const generation = generationService, prepared = preparer;
  let closing: Promise<void> | undefined;
  const invalidations = new Map<string, Promise<void>>();
  const lifecycle = Object.freeze({
    invalidateAttempt(attemptId: string): Promise<void> {
      const prior = invalidations.get(attemptId); if (prior) return prior;
      const pending = settleClosures([() => generation.invalidateAttempt(attemptId), () => prepared.invalidateAttempt(attemptId),
        () => referenceService.invalidateAttempt(attemptId)]).finally(() => { clients.delete(attemptId); invalidations.delete(attemptId); });
      invalidations.set(attemptId, pending); return pending;
    },
    close(): Promise<void> {
      closing ??= settleClosures([() => generation.close(), () => prepared.close(), () => referenceService.close()])
        .finally(() => { clients.clear(); invalidations.clear(); });
      return closing;
    }
  });
  return Object.freeze({ maxVideoFileBytes, referenceService, preparer: prepared, generationService: generation, lifecycle });
}
export function getOwnerWan27VideoEditRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}
async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner WAN 2.7 Video Edit cleanup was not confirmed.");
}
