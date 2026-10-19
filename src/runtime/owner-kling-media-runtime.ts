import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { OwnerKlingMediaReferenceService, type OwnerKlingMediaUploadDestination } from "../application/owner-kling-media-reference-service.js";
import { OwnerKlingMediaGenerationService, loadOwnerKlingMediaRuntimeCatalog } from "../application/owner-kling-media-generation-service.js";

const CLEANUPS = new WeakMap<object, Promise<void>>();
const MAX_CLIENTS = 128;
export interface OwnerKlingMediaRuntimeOptions { readonly binding: AuthBinding; readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient; readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly uploadDestination: OwnerKlingMediaUploadDestination; readonly ffprobePath: string; readonly now: () => number; readonly catalogDirectory?: string }

/** Default-off family composition. Destination and ffprobe binary are trusted operator configuration. */
export function createOwnerKlingMediaRuntime(options: OwnerKlingMediaRuntimeOptions) {
  if (!options || typeof options.createReadClient !== "function" || typeof options.createChatClient !== "function" || typeof options.now !== "function" ||
      typeof options.ffprobePath !== "string" || !options.ffprobePath || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden")) {
    throw new Error("OWNER_KLING_MEDIA_RUNTIME_CONFIGURATION_INVALID");
  }
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attempt: string): SyntxChatHttpClient => {
    const current = clients.get(attempt); if (current) return current;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_KLING_MEDIA_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attempt); clients.set(attempt, client); return client;
  };
  let references: OwnerKlingMediaReferenceService | undefined, generation: OwnerKlingMediaGenerationService | undefined;
  try {
    references = new OwnerKlingMediaReferenceService({ binding: options.binding, linkService: options.linkService, resolveClient: resolveChatClient,
      uploadDestination: options.uploadDestination, ffprobePath: options.ffprobePath, now: options.now });
    const catalog = loadOwnerKlingMediaRuntimeCatalog(options.catalogDirectory);
    generation = new OwnerKlingMediaGenerationService({ binding: options.binding, linkService: options.linkService, referenceService: references,
      catalog: catalog.catalog, ...(options.catalogDirectory ? { catalogDirectory: options.catalogDirectory } : {}), createReadClient: options.createReadClient,
      resolveChatClient, now: options.now });
  } catch (error) {
    const cleanup = Promise.allSettled([() => generation?.close(), () => references?.close()].map(async fn => fn())).then(results => {
      const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, "Owner Kling media startup cleanup failed.");
    }).finally(() => clients.clear());
    if (error && typeof error === "object") CLEANUPS.set(error, cleanup); void cleanup.catch(() => {}); throw error;
  }
  const refs = references!, gen = generation!; let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    async invalidateAttempt(attempt: string): Promise<void> { await gen.invalidateAttempt(attempt); await refs.invalidateAttempt(attempt); clients.delete(attempt); },
    close(): Promise<void> { closing ??= Promise.allSettled([gen.close(), refs.close()]).then(results => {
      const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, "Owner Kling media cleanup failed.");
    }).finally(() => clients.clear()); return closing; }
  });
  return Object.freeze({ referenceService: refs, generationService: gen, lifecycle });
}
export function getOwnerKlingMediaStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? CLEANUPS.get(error) : undefined;
}
