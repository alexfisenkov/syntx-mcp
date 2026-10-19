import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerHappyHorseUploadDestination } from "../adapter/syntx/owner-happy-horse-image-context.js";
import { OwnerHappyHorseImageReferenceService } from "../application/owner-happy-horse-image-reference-service.js";
import { OwnerHappyHorseEditVideoReferenceService } from "../application/owner-happy-horse-edit-video-reference-service.js";
import { OwnerHappyHorseGenerationService, loadOwnerHappyHorseRuntimeCatalog } from "../application/owner-happy-horse-generation-service.js";

const CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;
export interface OwnerHappyHorseRuntimeOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient; readonly uploadDestination: OwnerHappyHorseUploadDestination;
  readonly now: () => number; readonly ffprobePath: string; readonly catalogDirectory?: string;
}

/** Process-local composition. Upload destination is trusted runtime configuration, never MCP input. */
export function createOwnerHappyHorseRuntime(options: OwnerHappyHorseRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function" || typeof options.ffprobePath !== "string" || !options.ffprobePath ||
      (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden")) {
    throw new Error("OWNER_HAPPY_HORSE_RUNTIME_CONFIGURATION_INVALID");
  }
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attempt: string): SyntxChatHttpClient => {
    const current = clients.get(attempt); if (current) return current;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_HAPPY_HORSE_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attempt); clients.set(attempt, client); return client;
  };
  let referenceService: OwnerHappyHorseImageReferenceService | undefined;
  let editVideoReferenceService: OwnerHappyHorseEditVideoReferenceService | undefined;
  let generationService: OwnerHappyHorseGenerationService | undefined;
  try {
    const imageReferences = new OwnerHappyHorseImageReferenceService({ binding: options.binding, linkService: options.linkService,
      resolveClient: resolveChatClient, uploadDestination: options.uploadDestination, now: options.now });
    referenceService = imageReferences;
    const editVideoReferences = new OwnerHappyHorseEditVideoReferenceService({ binding: options.binding, linkService: options.linkService,
      resolveClient: resolveChatClient, uploadDestination: options.uploadDestination, ffprobePath: options.ffprobePath, now: options.now });
    editVideoReferenceService = editVideoReferences;
    const catalog = loadOwnerHappyHorseRuntimeCatalog(options.catalogDirectory);
    generationService = new OwnerHappyHorseGenerationService({ binding: options.binding, linkService: options.linkService,
      referenceService: imageReferences, editVideoReferenceService: editVideoReferences, catalog: catalog.catalog,
      ...(options.catalogDirectory ? { catalogDirectory: options.catalogDirectory } : {}),
      createReadClient: options.createReadClient, resolveChatClient, now: options.now });
  } catch (error) {
    const cleanup = settleClosures([
      () => generationService?.close(), () => editVideoReferenceService?.close(), () => referenceService?.close()
    ]).finally(() => clients.clear());
    if (error && typeof error === "object") CLEANUPS.set(error, cleanup);
    void cleanup.catch(() => {});
    throw error;
  }
  const generation = generationService!;
  const references = referenceService!;
  const editVideos = editVideoReferenceService!;
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    async invalidateAttempt(attempt: string): Promise<void> {
      await settleClosures([
        () => generation.invalidateAttempt(attempt),
        () => references.invalidateAttempt(attempt),
        () => editVideos.invalidateAttempt(attempt)
      ]).finally(() => clients.delete(attempt));
    },
    close(): Promise<void> {
      closing ??= settleClosures([() => generation.close(), () => references.close(), () => editVideos.close()])
        .finally(() => { clients.clear(); });
      return closing;
    }
  });
  return Object.freeze({ referenceService: references, editVideoReferenceService: editVideos, generationService: generation, lifecycle });
}
export function getOwnerHappyHorseStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? CLEANUPS.get(error) : undefined;
}

async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner HappyHorse cleanup was not confirmed.");
}
