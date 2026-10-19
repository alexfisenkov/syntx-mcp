import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { AccountStatusService } from "../application/account-status.js";
import { ModelAccessService } from "../application/model-access.js";
import { OwnerSwitchxVideoGenerationService } from "../application/owner-switchx-video-generation-service.js";

const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const MAX_CLIENTS = 128;
const CLEANUPS = new WeakMap<object, Promise<void>>();

export interface OwnerSwitchxVideoRuntimeOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly uploadDestination: "uploaded" | "hidden";
  readonly ffprobePath: string;
  readonly now: () => number;
  readonly catalogDirectory?: string;
}

/** Process-local composition; the destination and ffprobe binary are trusted operator configuration. */
export function createOwnerSwitchxVideoRuntime(options: OwnerSwitchxVideoRuntimeOptions | unknown) {
  const config = exact(options, ["binding", "linkService", "createReadClient", "createChatClient", "uploadDestination", "ffprobePath", "now"], ["catalogDirectory"]);
  if (!config.linkService || typeof config.linkService !== "object" || types.isProxy(config.linkService) ||
      typeof config.createReadClient !== "function" || types.isProxy(config.createReadClient) ||
      typeof config.createChatClient !== "function" || types.isProxy(config.createChatClient) ||
      typeof config.now !== "function" || types.isProxy(config.now) ||
      (config.uploadDestination !== "uploaded" && config.uploadDestination !== "hidden") ||
      typeof config.ffprobePath !== "string" || !config.ffprobePath.trim() ||
      (config.catalogDirectory !== undefined && typeof config.catalogDirectory !== "string")) {
    throw new Error("OWNER_SWITCHX_VIDEO_RUNTIME_CONFIGURATION_INVALID");
  }
  const selected = loadSelectedDiscoveryCatalog(CATALOG_VERSION, config.catalogDirectory as string | undefined);
  const clients = new Map<string, { readonly chat: SyntxChatHttpClient; readonly read: SyntxHttpClient }>();
  const clientPair = (attemptId: string) => {
    const current = clients.get(attemptId); if (current) return current;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_SWITCHX_VIDEO_RUNTIME_CLIENT_CAPACITY_EXCEEDED");
    const pair = Object.freeze({ chat: Reflect.apply(config.createChatClient as Function, undefined, [attemptId]) as SyntxChatHttpClient,
      read: Reflect.apply(config.createReadClient as Function, undefined, [attemptId]) as SyntxHttpClient });
    clients.set(attemptId, pair); return pair;
  };
  let service: OwnerSwitchxVideoGenerationService | undefined;
  try {
    service = new OwnerSwitchxVideoGenerationService({ binding: config.binding, linkService: config.linkService,
      catalog: selected.discoveryCatalog, catalog_version: CATALOG_VERSION, ffprobePath: config.ffprobePath as string,
      uploadDestination: config.uploadDestination, now: config.now as () => number,
      resolveChatClient: (attemptId: string) => clientPair(attemptId).chat,
      createAccountStatusService: (attemptId: string) => new AccountStatusService(clientPair(attemptId).read, config.now as () => number),
      createModelAccessService: (attemptId: string) => new ModelAccessService(selected.discoveryCatalog, clientPair(attemptId).read, config.now as () => number) });
  } catch (error) {
    const cleanup = Promise.resolve().then(() => clients.clear());
    if (error && typeof error === "object") CLEANUPS.set(error, cleanup);
    void cleanup.catch(() => {});
    throw error;
  }
  const generationService = service;
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    async invalidateAttempt(attemptId: string): Promise<void> {
      await generationService.invalidateAttempt(attemptId).finally(() => clients.delete(attemptId));
    },
    close(): Promise<void> {
      closing ??= generationService.close().finally(() => clients.clear());
      return closing;
    }
  });
  return Object.freeze({ generationService, lifecycle });
}

export function getOwnerSwitchxVideoStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? CLEANUPS.get(error) : undefined;
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("OWNER_SWITCHX_VIDEO_RUNTIME_CONFIGURATION_INVALID");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { throw new Error("OWNER_SWITCHX_VIDEO_RUNTIME_CONFIGURATION_INVALID"); }
  const keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
        (!required.includes(key) && !optional.includes(key)) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) {
    throw new Error("OWNER_SWITCHX_VIDEO_RUNTIME_CONFIGURATION_INVALID");
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
