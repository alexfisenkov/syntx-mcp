import type { PerUserLinkService } from "../../auth/link-service.js";
import type { AuthBinding } from "../../auth/types.js";
import type { SyntxCredentialBroker } from "./http-client.js";

/**
 * Binds one authenticated MCP principal and one linked attempt to the
 * read-only SYNTX HTTP client. Credential material remains inside callbacks.
 */
export class LinkedAttemptCredentialBroker implements SyntxCredentialBroker {
  readonly #linkService: PerUserLinkService;
  readonly #binding: AuthBinding;
  readonly #attemptId: string;

  constructor(
    linkService: PerUserLinkService,
    binding: AuthBinding,
    attemptId: string
  ) {
    this.#linkService = linkService;
    this.#binding = { ...binding };
    this.#attemptId = attemptId;
  }

  useCredential<T>(
    operation: (credential: string) => Promise<T>
  ): Promise<T> {
    return this.#linkService.useCredential(
      this.#binding,
      this.#attemptId,
      (credential) => operation(credential.value)
    );
  }
}
