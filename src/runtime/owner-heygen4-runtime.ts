import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { AccountStatusService } from "../application/account-status.js";
import { ModelAccessService } from "../application/model-access.js";
import { OwnerHeygen4ReferenceService } from "../application/owner-heygen4-reference-service.js";
import { OwnerHeygen4GenerationService } from "../application/owner-heygen4-generation-service.js";

const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CLEANUPS = new WeakMap<object, Promise<void>>();
export interface OwnerHeygen4RuntimeOptions { readonly binding: AuthBinding; readonly linkService: PerUserLinkService;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient; readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number; readonly ffprobePath: string; readonly catalogDirectory?: string; }
/** Default-off composition unit for HeyGen 4 existing-media import and its single bounded generation slice. */
export function createOwnerHeygen4Runtime(input: OwnerHeygen4RuntimeOptions | unknown) {
  const row = exact(input, ["binding", "linkService", "createReadClient", "createChatClient", "now", "ffprobePath"], ["catalogDirectory"]);
  if (!row.linkService || types.isProxy(row.linkService) || typeof row.createReadClient !== "function" || types.isProxy(row.createReadClient) ||
      typeof row.createChatClient !== "function" || types.isProxy(row.createChatClient) || typeof row.now !== "function" || types.isProxy(row.now) ||
      typeof row.ffprobePath !== "string" || !row.ffprobePath.startsWith("/") || row.ffprobePath.includes("\0") ||
      (row.catalogDirectory !== undefined && typeof row.catalogDirectory !== "string")) throw new Error("OWNER_HEYGEN4_RUNTIME_CONFIGURATION_INVALID");
  const selected = loadSelectedDiscoveryCatalog(CATALOG_VERSION, row.catalogDirectory as string | undefined);
  const clients = new Map<string, Readonly<{ chat: SyntxChatHttpClient; read: SyntxHttpClient }>>();
  const pairFor = (attemptId: string) => { let pair = clients.get(attemptId); if (!pair) {
    pair = Object.freeze({ chat: Reflect.apply(row.createChatClient as Function, undefined, [attemptId]) as SyntxChatHttpClient,
      read: Reflect.apply(row.createReadClient as Function, undefined, [attemptId]) as SyntxHttpClient }); clients.set(attemptId, pair); }
    return pair; };
  let references: OwnerHeygen4ReferenceService | undefined, service: OwnerHeygen4GenerationService | undefined;
  try {
    references = new OwnerHeygen4ReferenceService({ binding: row.binding as AuthBinding, linkService: row.linkService as PerUserLinkService,
      resolveClient: (attemptId: string) => pairFor(attemptId).chat, ffprobePath: row.ffprobePath as string, now: row.now as () => number });
    service = new OwnerHeygen4GenerationService({ binding: row.binding as AuthBinding, linkService: row.linkService as PerUserLinkService,
      catalog: selected.discoveryCatalog, catalog_version: CATALOG_VERSION, referenceService: references,
      resolveChatClient: (attemptId: string) => pairFor(attemptId).chat,
      createAccountStatusService: (attemptId: string) => new AccountStatusService(pairFor(attemptId).read, row.now as () => number),
      createModelAccessService: (attemptId: string) => new ModelAccessService(selected.discoveryCatalog, pairFor(attemptId).read, row.now as () => number),
      now: row.now as () => number });
  } catch (error) { const cleanup = Promise.resolve().then(() => clients.clear()); if (error && typeof error === "object") CLEANUPS.set(error, cleanup); void cleanup.catch(() => {}); throw error; }
  const generationService = service, referenceService = references; let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({ async invalidateAttempt(attemptId: string): Promise<void> {
    await Promise.all([generationService.invalidateAttempt(attemptId), referenceService.invalidateAttempt(attemptId)]); clients.delete(attemptId);
  }, close(): Promise<void> { closing ??= Promise.all([generationService.close(), referenceService.close()]).then(() => { clients.clear(); }); return closing; } });
  return Object.freeze({ importService: referenceService, generationService, lifecycle });
}
export function getOwnerHeygen4StartupCleanup(error: unknown): Promise<void> | undefined { return error && typeof error === "object" ? CLEANUPS.get(error) : undefined; }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("OWNER_HEYGEN4_RUNTIME_CONFIGURATION_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || required.some(key => !Object.hasOwn(descriptors, key)) ||
      keys.some(key => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true))
    throw new Error("OWNER_HEYGEN4_RUNTIME_CONFIGURATION_INVALID");
  const result = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
