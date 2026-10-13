import type { AuthBinding, ProviderCredential, PublicAuthLinkAttempt } from "./types.js";

export interface CreateAuthAttemptRecord { attempt_id: string; binding: AuthBinding; expires_at_ms: number; }
/** Port implemented by both process-local and durable auth stores. */
export interface AuthLinkStore {
  createAttempt(input: CreateAuthAttemptRecord): Promise<PublicAuthLinkAttempt>;
  beginHandoff(binding: AuthBinding, attemptId: string): Promise<void>;
  attachChallenge(binding: AuthBinding, attemptId: string, upstreamAttemptId: string): Promise<PublicAuthLinkAttempt>;
  beginPoll(binding: AuthBinding, attemptId: string): Promise<string>;
  markPending(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt>;
  markLinked(binding: AuthBinding, attemptId: string, credential: ProviderCredential): Promise<PublicAuthLinkAttempt>;
  markFailure(binding: AuthBinding, attemptId: string, retryable: boolean): Promise<PublicAuthLinkAttempt>;
  getSnapshot(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt>;
  revoke(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt>;
  useCredential<T>(binding: AuthBinding, attemptId: string, use: (credential: ProviderCredential) => T | Promise<T>): Promise<T>;
  close?(): void;
}
