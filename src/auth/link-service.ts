import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import type { AuthLinkStore } from "./auth-link-store.js";
import type {
  AuthBinding,
  AuthHandoffResult,
  AuthLinkProvider,
  ProviderCredential,
  PublicAuthLinkAttempt
} from "./types.js";
import { AuthLinkError, AuthProviderError } from "./types.js";

const bindingSchema = z
  .object({
    tenant_id: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
    subject: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))
  })
  .strict();
const attemptIdSchema = z
  .string()
  .regex(/^link_[A-Za-z0-9_-]{20,120}$/);

export interface PerUserLinkServiceOptions {
  defaultTtlMs?: number;
  now?: () => number;
  attemptIdGenerator?: () => string;
}

/**
 * Tenant-bound orchestration for the observed owner-authorized auth flow.
 * Public snapshots never contain the upstream UUID, Telegram payload, or token.
 */
export class PerUserLinkService {
  readonly #provider: AuthLinkProvider;
  readonly #store: AuthLinkStore;
  readonly #defaultTtlMs: number;
  readonly #now: () => number;
  readonly #attemptIdGenerator: () => string;

  constructor(
    provider: AuthLinkProvider,
    store: AuthLinkStore,
    options: PerUserLinkServiceOptions = {}
  ) {
    this.#provider = provider;
    this.#store = store;
    this.#defaultTtlMs = options.defaultTtlMs ?? 5 * 60_000;
    this.#now = options.now ?? Date.now;
    this.#attemptIdGenerator =
      options.attemptIdGenerator ??
      (() => `link_${randomBytes(24).toString("base64url")}`);
    if (
      !Number.isInteger(this.#defaultTtlMs) ||
      this.#defaultTtlMs < 1 ||
      this.#defaultTtlMs > 30 * 60_000
    ) {
      throw new AuthLinkError(
        "AUTH_LINK_EXPIRED",
        "The authentication attempt TTL is outside the allowed range."
      );
    }
  }

  async createAttempt(binding: AuthBinding): Promise<PublicAuthLinkAttempt> {
    const safeBinding = validateBinding(binding);
    const attemptId = this.#attemptIdGenerator();
    if (!attemptIdSchema.safeParse(attemptId).success) {
      throw new AuthLinkError(
        "INVALID_ATTEMPT_ID",
        "The generated authentication attempt id is invalid."
      );
    }
    return this.#store.createAttempt({
      attempt_id: attemptId,
      binding: safeBinding,
      expires_at_ms: this.#now() + this.#defaultTtlMs
    });
  }

  async issueHandoff(
    binding: AuthBinding,
    attemptId: string,
    signal?: AbortSignal
  ): Promise<AuthHandoffResult> {
    const safeBinding = validateBinding(binding);
    const safeAttemptId = validateAttemptId(attemptId);
    await this.#store.beginHandoff(safeBinding, safeAttemptId);

    try {
      const challenge = await this.#provider.createChallenge(signal);
      const attempt = await this.#store.attachChallenge(
        safeBinding,
        safeAttemptId,
        challenge.upstream_attempt_id
      );
      return { attempt, approval_url: challenge.approval_url };
    } catch (error) {
      if (isRequestAborted(error)) {
        await this.#store.markFailure(safeBinding, safeAttemptId, true);
        throw error;
      }
      if (
        error instanceof AuthLinkError &&
        !(error instanceof AuthProviderError) &&
        error.code !== "INVALID_APPROVAL_URL"
      ) {
        throw error;
      }
      const retryable =
        error instanceof AuthProviderError ? error.retryable : false;
      const attempt = await this.#store.markFailure(
        safeBinding,
        safeAttemptId,
        retryable
      );
      return { attempt, approval_url: null };
    }
  }

  async checkAttempt(
    binding: AuthBinding,
    attemptId: string,
    signal?: AbortSignal
  ): Promise<PublicAuthLinkAttempt> {
    const safeBinding = validateBinding(binding);
    const safeAttemptId = validateAttemptId(attemptId);
    const current = await this.#store.getSnapshot(safeBinding, safeAttemptId);
    if (
      current.status === "LINKED" ||
      current.status === "EXPIRED" ||
      current.status === "FAILED_TERMINAL" ||
      current.status === "HANDOFF_OUTCOME_UNKNOWN" ||
      current.status === "POLL_OUTCOME_UNKNOWN" ||
      current.status === "REVOKED"
    ) {
      return current;
    }
    if (current.status === "CHALLENGE_CREATED") throw invalidState();

    const upstreamAttemptId = await this.#store.beginPoll(
      safeBinding,
      safeAttemptId
    );
    try {
      const outcome = await this.#provider.pollChallenge(
        upstreamAttemptId,
        async (credential) => {
          await this.#store.markLinked(
            safeBinding,
            safeAttemptId,
            credential
          );
        },
        signal
      );
      if (outcome.state === "FAILED_TERMINAL") {
        return this.#store.markFailure(safeBinding, safeAttemptId, false);
      }
      if (outcome.state === "PENDING") {
        return this.#store.markPending(safeBinding, safeAttemptId);
      }
      return this.#store.getSnapshot(safeBinding, safeAttemptId);
    } catch (error) {
      if (isRequestAborted(error)) {
        await this.#store.markFailure(safeBinding, safeAttemptId, true);
        throw error;
      }
      if (error instanceof AuthLinkError && !(error instanceof AuthProviderError)) {
        throw error;
      }
      const retryable =
        error instanceof AuthProviderError ? error.retryable : true;
      return this.#store.markFailure(
        safeBinding,
        safeAttemptId,
        retryable
      );
    }
  }

  getStatus(
    binding: AuthBinding,
    attemptId: string
  ): Promise<PublicAuthLinkAttempt> {
    return this.#store.getSnapshot(
      validateBinding(binding),
      validateAttemptId(attemptId)
    );
  }

  revoke(
    binding: AuthBinding,
    attemptId: string
  ): Promise<PublicAuthLinkAttempt> {
    return this.#store.revoke(
      validateBinding(binding),
      validateAttemptId(attemptId)
    );
  }

  useCredential<T>(
    binding: AuthBinding,
    attemptId: string,
    use: (credential: ProviderCredential) => T | Promise<T>
  ): Promise<T> {
    return this.#store.useCredential(
      validateBinding(binding),
      validateAttemptId(attemptId),
      use
    );
  }
}

function isRequestAborted(error: unknown): error is AuthLinkError {
  return error instanceof AuthLinkError && error.code === "AUTH_REQUEST_ABORTED";
}

function validateBinding(binding: AuthBinding): AuthBinding {
  const parsed = bindingSchema.safeParse(binding);
  if (!parsed.success) {
    throw new AuthLinkError(
      "INVALID_AUTH_BINDING",
      "A valid tenant and authenticated subject are required."
    );
  }
  return parsed.data;
}

function validateAttemptId(attemptId: string): string {
  const parsed = attemptIdSchema.safeParse(attemptId);
  if (!parsed.success) {
    throw new AuthLinkError(
      "INVALID_ATTEMPT_ID",
      "The authentication attempt id is invalid."
    );
  }
  return parsed.data;
}

function invalidState(): AuthLinkError {
  return new AuthLinkError(
    "AUTH_LINK_INVALID_STATE",
    "The authentication attempt cannot perform that transition."
  );
}
