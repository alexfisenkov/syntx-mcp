import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerActTwoUploadDestination } from "../adapter/syntx/owner-acttwo-image-context.js";
import { OwnerActTwoImageReferenceService } from "../application/owner-acttwo-image-reference-service.js";
import { OwnerActTwoPerformanceVideoReferenceService } from "../application/owner-acttwo-video-reference-service.js";
import { OwnerActTwoGenerationService, loadOwnerActTwoGenerationCatalog } from "../application/owner-acttwo-generation-service.js";

const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;
export interface OwnerActTwoRuntimeOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly uploadDestination: OwnerActTwoUploadDestination;
  readonly ffprobePath: string;
  readonly now: () => number;
  readonly catalogDirectory?: string;
}

/** Process-local ActTwo composition. Upload destination and ffprobe path are trusted operator configuration. */
export function createOwnerActTwoRuntime(options: OwnerActTwoRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" ||
      typeof options.now !== "function" || typeof options.ffprobePath !== "string" || !options.ffprobePath ||
      (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden")) {
    throw new Error("OWNER_ACTTWO_RUNTIME_CONFIGURATION_INVALID");
  }
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const current = clients.get(attemptId); if (current) return current;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_ACTTWO_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attemptId); clients.set(attemptId, client); return client;
  };
  let imageReferenceService: OwnerActTwoImageReferenceService | undefined;
  let videoReferenceService: OwnerActTwoPerformanceVideoReferenceService | undefined;
  let generationService: OwnerActTwoGenerationService | undefined;
  try {
    const images = new OwnerActTwoImageReferenceService({ binding: options.binding, linkService: options.linkService,
      resolveClient: resolveChatClient, uploadDestination: options.uploadDestination, now: options.now });
    imageReferenceService = images;
    const videos = new OwnerActTwoPerformanceVideoReferenceService({ binding: options.binding, linkService: options.linkService,
      resolveClient: resolveChatClient, uploadDestination: options.uploadDestination, ffprobePath: options.ffprobePath, now: options.now });
    videoReferenceService = videos;
    const catalog = loadOwnerActTwoGenerationCatalog(options.catalogDirectory);
    generationService = new OwnerActTwoGenerationService({ binding: options.binding, linkService: options.linkService,
      imageReferenceService: images, videoReferenceService: videos, catalog: catalog.catalog,
      ...(options.catalogDirectory ? { catalogDirectory: options.catalogDirectory } : {}),
      createReadClient: options.createReadClient, resolveChatClient, now: options.now });
  } catch (error) {
    const cleanup = settleClosures([
      () => generationService?.close(), () => videoReferenceService?.close(), () => imageReferenceService?.close()
    ]).finally(() => clients.clear());
    if (error && typeof error === "object") STARTUP_CLEANUPS.set(error, cleanup);
    void cleanup.catch(() => {});
    throw error;
  }
  const images = imageReferenceService!, videos = videoReferenceService!, generation = generationService!;
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    async invalidateAttempt(attemptId: string): Promise<void> {
      await settleClosures([
        () => generation.invalidateAttempt(attemptId),
        () => images.invalidateAttempt(attemptId),
        () => videos.invalidateAttempt(attemptId)
      ]).finally(() => clients.delete(attemptId));
    },
    close(): Promise<void> {
      closing ??= settleClosures([() => generation.close(), () => images.close(), () => videos.close()]).finally(() => clients.clear());
      return closing;
    }
  });
  return Object.freeze({ imageReferenceService: images, videoReferenceService: videos, generationService: generation, lifecycle });
}

export function getOwnerActTwoStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}

async function settleClosures(closures: readonly (() => Promise<void> | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(closures.map(async close => close()));
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Owner ActTwo cleanup was not confirmed.");
}
