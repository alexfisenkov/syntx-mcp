import { isAbsolute, resolve } from "node:path";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { AccountStatusService } from "../application/account-status.js";
import { ModelAccessService } from "../application/model-access.js";
import { getOwnerVeoOmniReferenceProfile } from "../application/owner-veo-omni-reference-profile.js";
import { OwnerVeoOmniReferenceService } from "../application/owner-veo-omni-reference-service.js";
import { createOwnerVeoOmniReferenceRequestPreparer } from "../application/owner-veo-omni-reference-request-preparer.js";
import { OwnerVeoOmniReferenceGenerationService } from "../application/owner-veo-omni-reference-generation-service.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
export interface OwnerVeoOmniReferenceRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly ffprobePath: string;
  readonly maxFileBytes?: number;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number;
}

/** Exact C19 owner-local composition, independent of legacy Veo and Omni no-reference paths. */
export function createOwnerVeoOmniReferenceRuntime(options: OwnerVeoOmniReferenceRuntimeOptions) {
  const profile = getOwnerVeoOmniReferenceProfile();
  const maxFileBytes = options.maxFileBytes ?? profile.local_resource_policy.default_max_file_bytes;
  if (typeof options.ffprobePath !== "string" || !options.ffprobePath || options.ffprobePath !== options.ffprobePath.trim() ||
      options.ffprobePath.includes("\0") || !isAbsolute(options.ffprobePath) || resolve(options.ffprobePath) !== options.ffprobePath ||
      !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > profile.public_limits.max_file_size_bytes) {
    throw new Error("OWNER_VEO_OMNI_REFERENCE_OPERATOR_CONFIGURATION_REQUIRED");
  }
  const catalogVersion = profile.source_pins.public_catalog_version;
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(catalogVersion, options.catalogDirectory));
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveClient = (attemptId: string) => {
    const prior = clients.get(attemptId);
    if (prior) return prior;
    if (clients.size >= 128) throw new Error("OWNER_VEO_OMNI_REFERENCE_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId);
    clients.set(attemptId, client);
    return client;
  };
  const referenceService = new OwnerVeoOmniReferenceService({ binding: options.binding, linkService: options.linkService,
    resolveClient, ffprobePath: options.ffprobePath, maxFileBytes, now: options.now });
  let preparer: ReturnType<typeof createOwnerVeoOmniReferenceRequestPreparer> | undefined;
  let generationService: OwnerVeoOmniReferenceGenerationService | undefined;
  try {
    preparer = createOwnerVeoOmniReferenceRequestPreparer({ referenceService, now: options.now });
    generationService = new OwnerVeoOmniReferenceGenerationService({ binding: options.binding, linkService: options.linkService,
      catalog, catalog_version: catalogVersion, preparer, referenceService, resolveChatClient: resolveClient,
      createAccountStatusService: (attemptId: string) => new AccountStatusService(options.createReadClient(attemptId), options.now),
      createModelAccessService: (attemptId: string) => new ModelAccessService(catalog, options.createReadClient(attemptId), options.now),
      resolveSubscription: (attemptId: string, signal?: AbortSignal) => options.createReadClient(attemptId).getSubscription(signal), now: options.now });
  } catch (error) {
    const cleanup = settleClosures([() => generationService?.close(), () => preparer?.close(), () => referenceService.close()])
      .finally(() => clients.clear());
    // The outer owner runtime registers this promise for its stdio startup cleanup boundary.
    cleanup.catch(() => {});
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }
  const generation = generationService, prepared = preparer;
  let closing: Promise<void> | undefined;
  const invalidations = new Map<string, Promise<void>>();
  const lifecycle = Object.freeze({
    invalidateAttempt(attemptId: string): Promise<void> {
      const prior = invalidations.get(attemptId);
      if (prior) return prior;
      const pending = settleClosures([() => generation.invalidateAttempt(attemptId), () => prepared.invalidateAttempt(attemptId),
        () => referenceService.invalidateAttempt(attemptId)]).finally(() => { clients.delete(attemptId); invalidations.delete(attemptId); });
      invalidations.set(attemptId, pending);
      return pending;
    },
    close(): Promise<void> {
      closing ??= settleClosures([() => generation.close(), () => prepared.close(), () => referenceService.close()])
        .finally(() => { clients.clear(); invalidations.clear(); });
      return closing;
    }
  });
  return Object.freeze({ profile, maxFileBytes, referenceService, preparer: prepared, generationService: generation, lifecycle });
}

export function getOwnerVeoOmniReferenceRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}
async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  // Start every invalidation synchronously before awaiting any drain.
  const results = await Promise.allSettled(closures.map(async (close) => close()));
  const errors = results.flatMap((r) => r.status === "rejected" ? [r.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner Omni reference cleanup was incomplete.");
}
