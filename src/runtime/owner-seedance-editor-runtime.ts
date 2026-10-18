import { isAbsolute, resolve } from "node:path";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerSeedanceEditorRuntimeCatalog } from "../application/owner-seedance-editor-cost.js";
import { loadOwnerSeedanceEditorRuntimeCatalog } from "../application/owner-seedance-editor-cost.js";
import { OwnerSeedanceEditorReferenceService } from "../application/owner-seedance-editor-reference-service.js";
import { OwnerSeedanceEditorGenerationService } from "../application/owner-seedance-editor-generation-service.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
const DEFAULT_VIDEO_FILE_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_FILE_BYTES = 100 * 1024 * 1024;
const MAX_CLIENTS = 128;

export interface OwnerSeedanceEditorRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly ffprobePath: string;
  readonly maxVideoFileBytes?: number;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number;
}

/** Process-local owner Seedance Editor composition with one bounded video-reference vault and recovery service. */
export function createOwnerSeedanceEditorRuntime(options: OwnerSeedanceEditorRuntimeOptions) {
  const maxVideoFileBytes = options.maxVideoFileBytes ?? DEFAULT_VIDEO_FILE_BYTES;
  if (typeof options.ffprobePath !== "string" || !options.ffprobePath || options.ffprobePath !== options.ffprobePath.trim() ||
      options.ffprobePath.includes("\0") || !isAbsolute(options.ffprobePath) || resolve(options.ffprobePath) !== options.ffprobePath ||
      !Number.isSafeInteger(maxVideoFileBytes) || maxVideoFileBytes < 1 || maxVideoFileBytes > MAX_VIDEO_FILE_BYTES ||
      typeof options.now !== "function" || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function") {
    throw new Error("OWNER_SEEDANCE_EDITOR_OPERATOR_CONFIGURATION_REQUIRED");
  }
  const runtimeCatalog = loadOwnerSeedanceEditorRuntimeCatalog(options.catalogDirectory);
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const prior = clients.get(attemptId);
    if (prior) return prior;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_SEEDANCE_EDITOR_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId);
    clients.set(attemptId, client);
    return client;
  };
  const referenceService = new OwnerSeedanceEditorReferenceService({ binding: options.binding, linkService: options.linkService,
    resolveClient: resolveChatClient, ffprobePath: options.ffprobePath, maxVideoFileBytes, now: options.now });
  let generationService: OwnerSeedanceEditorGenerationService | undefined;
  try {
    generationService = new OwnerSeedanceEditorGenerationService({
      binding: options.binding, linkService: options.linkService, referenceService, catalog: runtimeCatalog.catalog,
      resolveChatClient, createReadClient: options.createReadClient, now: options.now
    });
  } catch (error) {
    const cleanup = settleClosures([() => generationService?.close(), () => referenceService.close()]).finally(() => clients.clear());
    cleanup.catch(() => {});
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    throw error;
  }
  const generation = generationService;
  let closing: Promise<void> | undefined;
  const invalidations = new Map<string, Promise<void>>();
  const lifecycle = Object.freeze({
    invalidateAttempt(attemptId: string): Promise<void> {
      const prior = invalidations.get(attemptId); if (prior) return prior;
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
  return Object.freeze({ maxVideoFileBytes, runtimeCatalog: runtimeCatalog as OwnerSeedanceEditorRuntimeCatalog,
    referenceService, generationService: generation, lifecycle });
}

export function getOwnerSeedanceEditorRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}

async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner Seedance Editor cleanup was not confirmed.");
}
