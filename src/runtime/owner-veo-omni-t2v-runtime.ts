import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { AccountStatusService } from "../application/account-status.js";
import { ModelAccessService } from "../application/model-access.js";
import { createOwnerVeoOmniT2vProfile } from "../application/owner-veo-omni-t2v-profile.js";
import { OwnerVeoOmniT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";

export interface OwnerVeoOmniT2vRuntimeOptions {
  readonly catalogDirectory?: string;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly createReadClient: (attemptId: string) => SyntxHttpClient;
  readonly createChatClient: (attemptId: string) => SyntxChatHttpClient;
  readonly now: () => number;
}

/** Owner-local composition: the Omni catalog and budget reader never use legacy Veo pins. */
export function createOwnerVeoOmniT2vRuntime(options: OwnerVeoOmniT2vRuntimeOptions) {
  const profile = createOwnerVeoOmniT2vProfile(options.catalogDirectory);
  const clients = new Map<string, SyntxChatHttpClient>();
  let generationService: OwnerVeoOmniT2vGenerationService;
  try {
    generationService = new OwnerVeoOmniT2vGenerationService({
      profile, binding: options.binding, linkService: options.linkService, now: options.now,
      resolveSubscription: (attemptId, signal) => options.createReadClient(attemptId).getSubscription(signal),
      resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
        new ModelAccessService(profile.catalog, options.createReadClient(attemptId), options.now).getModelAccess({
          model_id: modelId, cost_parameters: costParameters
        }, signal),
      resolveAccountStatus: (attemptId, signal) =>
        new AccountStatusService(options.createReadClient(attemptId), options.now).getAccountStatus(signal),
      resolveChatClient: (attemptId) => {
        const existing = clients.get(attemptId);
        if (existing) return existing;
        if (clients.size >= 128) throw new Error("OWNER_VEO_OMNI_T2V_CLIENT_CAPACITY_EXCEEDED");
        const client = options.createChatClient(attemptId);
        clients.set(attemptId, client);
        return client;
      }
    });
  } catch (error) { clients.clear(); throw error; }
  let closing: Promise<void> | undefined;
  const lifecycle = Object.freeze({
    async invalidateAttempt(attemptId: string): Promise<void> {
      try { await generationService.invalidateAttempt(attemptId); }
      finally { clients.delete(attemptId); }
    },
    close(): Promise<void> {
      closing ??= (async () => {
        try { await generationService.close(); }
        finally { clients.clear(); }
      })();
      return closing;
    }
  });
  return Object.freeze({ profile, generationService, lifecycle });
}
