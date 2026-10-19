import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { OwnerExistingVideoRecoveryService } from "../application/owner-existing-video-recovery-service.js";

const MAX_CLIENTS = 64;
const STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();
export interface OwnerExistingVideoRecoveryRuntimeOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** Runtime composition for a fixed GET-only rescue reader; no catalog, vault, or generation client is accepted. */
export function createOwnerExistingVideoRecoveryRuntime(options: OwnerExistingVideoRecoveryRuntimeOptions) {
  if (!options || typeof options.createChatClient !== "function") {
    throw new Error("OWNER_EXISTING_VIDEO_RECOVERY_RUNTIME_CONFIGURATION_INVALID");
  }
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attempt: string): SyntxChatHttpClient => {
    const existing = clients.get(attempt); if (existing) return existing;
    if (clients.size >= MAX_CLIENTS) throw new Error("OWNER_EXISTING_VIDEO_RECOVERY_CLIENT_CAPACITY_EXCEEDED");
    const client = options.createChatClient(attempt); clients.set(attempt, client); return client;
  };
  let service: OwnerExistingVideoRecoveryService | undefined;
  try {
    service = new OwnerExistingVideoRecoveryService({ binding: options.binding, linkService: options.linkService, resolveChatClient,
      ...(options.now ? { now: options.now } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  } catch (error) {
    STARTUP_CLEANUPS.set(error as object, Promise.resolve().then(() => { clients.clear(); }));
    throw error;
  }
  const recovery = service;
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    invalidateAttempt(attempt: string): Promise<void> {
      return recovery.invalidateAttempt(attempt).finally(() => clients.delete(attempt));
    },
    close(): Promise<void> {
      closing ??= recovery.close().finally(() => clients.clear());
      return closing;
    }
  });
  return Object.freeze({ recoveryService: recovery, lifecycle });
}

export function getOwnerExistingVideoRecoveryRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error && typeof error === "object" ? STARTUP_CLEANUPS.get(error) : undefined;
}
