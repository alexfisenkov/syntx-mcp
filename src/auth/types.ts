export const OBSERVED_AUTHORIZATION_PROFILE =
  "OBSERVED_OWNER_AUTHORIZED" as const;

export const AUTH_LINK_STATUSES = [
  "CHALLENGE_CREATED",
  "HANDOFF_ISSUED",
  "POLLING",
  "HANDOFF_OUTCOME_UNKNOWN",
  "POLL_OUTCOME_UNKNOWN",
  "LINKED",
  "EXPIRED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "REVOKED"
] as const;

export type AuthLinkStatus = (typeof AUTH_LINK_STATUSES)[number];

export interface AuthBinding {
  tenant_id: string;
  subject: string;
}

/** Safe to return from a status endpoint or serialize in diagnostics. */
export interface PublicAuthLinkAttempt {
  attempt_id: string;
  authorization_profile: typeof OBSERVED_AUTHORIZATION_PROFILE;
  status: AuthLinkStatus;
  expires_at: string | null;
  linked: boolean;
}

/** Returned only by the explicit user-facing handoff operation. */
export interface AuthHandoffResult {
  attempt: PublicAuthLinkAttempt;
  approval_url: string | null;
}

export interface ProviderChallenge {
  /** Private provider identifier. It must never enter a public attempt view. */
  upstream_attempt_id: string;
  approval_url: string;
}

export interface ProviderCredential {
  scheme: "Bearer";
  value: string;
}

export type ProviderCredentialReceiver = (
  credential: ProviderCredential
) => void | Promise<void>;

export type ProviderPollOutcome =
  | { state: "PENDING" }
  | { state: "LINKED" }
  | { state: "FAILED_TERMINAL" };

/**
 * Port for the owner-authorized flow observed on the live SYNTX web surface.
 * This is deliberately not described as official OAuth.
 */
export interface AuthLinkProvider {
  readonly authorizationProfile: typeof OBSERVED_AUTHORIZATION_PROFILE;
  createChallenge(signal?: AbortSignal): Promise<ProviderChallenge>;
  pollChallenge(
    upstreamAttemptId: string,
    receiveCredential: ProviderCredentialReceiver,
    signal?: AbortSignal
  ): Promise<ProviderPollOutcome>;
}

export type AuthLinkErrorCode =
  | "INVALID_AUTH_BINDING"
  | "INVALID_ATTEMPT_ID"
  | "AUTH_LINK_NOT_FOUND"
  | "AUTH_LINK_INVALID_STATE"
  | "AUTH_LINK_EXPIRED"
  | "AUTH_CREDENTIAL_UNAVAILABLE"
  | "AUTH_PROVIDER_RETRYABLE"
  | "AUTH_PROVIDER_TERMINAL"
  | "AUTH_REQUEST_ABORTED"
  | "INVALID_API_BASE"
  | "INVALID_APPROVAL_URL"
  | "MALFORMED_PROVIDER_RESPONSE";

export class AuthLinkError extends Error {
  constructor(
    readonly code: AuthLinkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AuthLinkError";
  }
}

export class AuthProviderError extends AuthLinkError {
  constructor(
    code:
      | "AUTH_PROVIDER_RETRYABLE"
      | "AUTH_PROVIDER_TERMINAL"
      | "MALFORMED_PROVIDER_RESPONSE",
    readonly retryable: boolean,
    message: string
  ) {
    super(code, message);
    this.name = "AuthProviderError";
  }
}
