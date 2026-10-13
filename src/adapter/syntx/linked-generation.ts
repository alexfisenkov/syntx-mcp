import type { AuthBinding } from "../../auth/types.js";
import { AuthLinkError } from "../../auth/types.js";
import type { PerUserLinkService } from "../../auth/link-service.js";
import { snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { LinkedAttemptCredentialBroker } from "./link-credential-broker.js";
import { SyntxChatHttpClient, type SyntxChatHttpClientOptions } from "./chat-http-client.js";
import { SyntxUpstreamAdapter, type SyntxUpstreamAdapterOptions } from "./upstream-adapter.js";

export type LinkedGenerationOptions = Omit<
  SyntxUpstreamAdapterOptions, "resolveChatClient" | "boundPrincipal"
> & Pick<SyntxChatHttpClientOptions, "fetchImpl" | "requestTimeoutMs" | "maxResponseBytes"> & {
  /** Server-authenticated binding, never accepted from an MCP tool. */
  binding: AuthBinding;
  attemptId: string;
  linkService: PerUserLinkService;
};

/**
 * Internal composition only, not an execution profile or an approval issuer.
 * Resolves an exact existing attempt locally, without polling/creating auth or
 * reading credentials. A revoked attempt may still replay its durable receipt;
 * the broker independently blocks every subsequent upstream credential use.
 * The returned raw adapter trusts consumed approvals and cannot enforce a
 * cost cap. Never expose it directly as a model-callable mutation capability.
 */
export async function createLinkedGenerationAdapter(options: LinkedGenerationOptions) {
  const principal = snapshotGenerationPrincipal({
    tenant_id: options.binding.tenant_id,
    subject_id: options.binding.subject,
    connection_id: options.attemptId
  });
  const binding = Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  // Capture dependencies before the first await; callers cannot rebind them.
  const linkService = options.linkService;
  const broker = new LinkedAttemptCredentialBroker(linkService, binding, principal.connection_id);
  const client = new SyntxChatHttpClient({
    credentialBroker: broker,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes })
  });
  const adapter = new SyntxUpstreamAdapter({
    transactionStore: options.transactionStore,
    boundPrincipal: principal,
    resolveChatClient: () => client,
    resolveAiName: options.resolveAiName,
    resolveModality: options.resolveModality,
    ...(options.prepareMediaRequest === undefined ? {} : { prepareMediaRequest: options.prepareMediaRequest }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createOperationId === undefined ? {} : { createOperationId: options.createOperationId })
  });
  const attempt = await linkService.getStatus(binding, principal.connection_id);
  if (attempt.status !== "LINKED" && attempt.status !== "REVOKED") {
    throw new AuthLinkError("AUTH_LINK_INVALID_STATE", "Complete account linking before creating the generation adapter.");
  }
  return Object.freeze({ principal, adapter });
}
