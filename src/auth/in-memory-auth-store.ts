import type {
  AuthBinding,
  AuthLinkStatus,
  ProviderCredential,
  PublicAuthLinkAttempt
} from "./types.js";
import {
  AuthLinkError,
  OBSERVED_AUTHORIZATION_PROFILE
} from "./types.js";
import type { AuthLinkStore, CreateAuthAttemptRecord } from "./auth-link-store.js";

interface StoredAuthAttempt {
  attemptId: string;
  tenantId: string;
  subject: string;
  status: AuthLinkStatus;
  expiresAtMs: number | null;
  upstreamAttemptId: string | null;
  credential: ProviderCredential | null;
  handoffInFlight: boolean;
  pollInFlight: boolean;
}

/**
 * Process-local MVP store. Private fields intentionally make accidental JSON
 * serialization empty; correctness across restarts requires a future durable,
 * encrypted implementation of AuthLinkStore.
 */
export class InMemoryAuthLinkStore implements AuthLinkStore {
  readonly #attempts = new Map<string, StoredAuthAttempt>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  close(): void {
    this.#attempts.clear();
  }

  async createAttempt(
    input: CreateAuthAttemptRecord
  ): Promise<PublicAuthLinkAttempt> {
    if (this.#attempts.has(input.attempt_id)) {
      throw new AuthLinkError(
        "INVALID_ATTEMPT_ID",
        "The generated authentication attempt id is unavailable."
      );
    }
    const record: StoredAuthAttempt = {
      attemptId: input.attempt_id,
      tenantId: input.binding.tenant_id,
      subject: input.binding.subject,
      status: "CHALLENGE_CREATED",
      expiresAtMs: input.expires_at_ms,
      upstreamAttemptId: null,
      credential: null,
      handoffInFlight: false,
      pollInFlight: false
    };
    this.#attempts.set(record.attemptId, record);
    return publicSnapshot(record);
  }

  async beginHandoff(binding: AuthBinding, attemptId: string): Promise<void> {
    const record = this.#requireBound(binding, attemptId);
    const retryWithoutChallenge =
      record.status === "FAILED_RETRYABLE" &&
      record.upstreamAttemptId === null;
    if (
      (record.status !== "CHALLENGE_CREATED" && !retryWithoutChallenge) ||
      record.handoffInFlight
    ) {
      throw invalidState();
    }
    record.status = "CHALLENGE_CREATED";
    record.handoffInFlight = true;
  }

  async attachChallenge(
    binding: AuthBinding,
    attemptId: string,
    upstreamAttemptId: string
  ): Promise<PublicAuthLinkAttempt> {
    const record = this.#requireBound(binding, attemptId);
    if (record.status !== "CHALLENGE_CREATED" || !record.handoffInFlight) {
      throw invalidState();
    }
    record.upstreamAttemptId = upstreamAttemptId;
    record.handoffInFlight = false;
    record.status = "HANDOFF_ISSUED";
    return publicSnapshot(record);
  }

  async beginPoll(binding: AuthBinding, attemptId: string): Promise<string> {
    const record = this.#requireBound(binding, attemptId);
    if (
      record.status !== "HANDOFF_ISSUED" &&
      record.status !== "POLLING" &&
      record.status !== "FAILED_RETRYABLE"
    ) {
      throw invalidState();
    }
    if (record.upstreamAttemptId === null || record.pollInFlight) {
      throw invalidState();
    }
    record.status = "POLLING";
    record.pollInFlight = true;
    return record.upstreamAttemptId;
  }

  async markPending(
    binding: AuthBinding,
    attemptId: string
  ): Promise<PublicAuthLinkAttempt> {
    const record = this.#requireBound(binding, attemptId);
    if (record.status !== "POLLING" || !record.pollInFlight) {
      throw invalidState();
    }
    record.pollInFlight = false;
    return publicSnapshot(record);
  }

  async markLinked(
    binding: AuthBinding,
    attemptId: string,
    credential: ProviderCredential
  ): Promise<PublicAuthLinkAttempt> {
    const record = this.#requireBound(binding, attemptId);
    if (record.status !== "POLLING" || !record.pollInFlight) {
      throw invalidState();
    }
    record.credential = credential;
    record.upstreamAttemptId = null;
    record.expiresAtMs = null;
    record.pollInFlight = false;
    record.status = "LINKED";
    return publicSnapshot(record);
  }

  async markFailure(
    binding: AuthBinding,
    attemptId: string,
    retryable: boolean
  ): Promise<PublicAuthLinkAttempt> {
    const record = this.#requireBound(binding, attemptId);
    if (isTerminal(record.status)) return publicSnapshot(record);
    record.status = retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL";
    record.handoffInFlight = false;
    record.pollInFlight = false;
    if (!retryable) clearPrivateMaterial(record);
    return publicSnapshot(record);
  }

  async getSnapshot(
    binding: AuthBinding,
    attemptId: string
  ): Promise<PublicAuthLinkAttempt> {
    return publicSnapshot(this.#requireBound(binding, attemptId));
  }

  async revoke(
    binding: AuthBinding,
    attemptId: string
  ): Promise<PublicAuthLinkAttempt> {
    const record = this.#requireBound(binding, attemptId);
    clearPrivateMaterial(record);
    record.expiresAtMs = null;
    record.status = "REVOKED";
    return publicSnapshot(record);
  }

  async useCredential<T>(
    binding: AuthBinding,
    attemptId: string,
    use: (credential: ProviderCredential) => T | Promise<T>
  ): Promise<T> {
    const record = this.#requireBound(binding, attemptId);
    if (record.status !== "LINKED" || record.credential === null) {
      throw new AuthLinkError(
        "AUTH_CREDENTIAL_UNAVAILABLE",
        "No linked credential is available for this authentication attempt."
      );
    }
    return await use({ ...record.credential });
  }

  #requireBound(binding: AuthBinding, attemptId: string): StoredAuthAttempt {
    const record = this.#attempts.get(attemptId);
    if (
      !record ||
      record.tenantId !== binding.tenant_id ||
      record.subject !== binding.subject
    ) {
      throw new AuthLinkError(
        "AUTH_LINK_NOT_FOUND",
        "The authentication attempt is not available for this principal."
      );
    }
    if (
      record.expiresAtMs !== null &&
      record.expiresAtMs <= this.#now() &&
      !isTerminal(record.status)
    ) {
      clearPrivateMaterial(record);
      record.expiresAtMs = null;
      record.status = "EXPIRED";
    }
    return record;
  }
}

function publicSnapshot(record: StoredAuthAttempt): PublicAuthLinkAttempt {
  return {
    attempt_id: record.attemptId,
    authorization_profile: OBSERVED_AUTHORIZATION_PROFILE,
    status: record.status,
    expires_at:
      record.expiresAtMs === null
        ? null
        : new Date(record.expiresAtMs).toISOString(),
    linked: record.status === "LINKED"
  };
}

function clearPrivateMaterial(record: StoredAuthAttempt): void {
  record.upstreamAttemptId = null;
  record.credential = null;
  record.handoffInFlight = false;
  record.pollInFlight = false;
}

function isTerminal(status: AuthLinkStatus): boolean {
  return (
    status === "LINKED" ||
    status === "EXPIRED" ||
    status === "FAILED_TERMINAL" ||
    status === "HANDOFF_OUTCOME_UNKNOWN" ||
    status === "POLL_OUTCOME_UNKNOWN" ||
    status === "REVOKED"
  );
}

function invalidState(): AuthLinkError {
  return new AuthLinkError(
    "AUTH_LINK_INVALID_STATE",
    "The authentication attempt cannot perform that transition."
  );
}
