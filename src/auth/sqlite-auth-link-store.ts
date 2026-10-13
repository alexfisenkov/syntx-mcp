import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuthLinkSecretEnvelope, AuthLinkSecretVault } from "./auth-link-secret-vault.js";
import type {
  AuthBinding,
  AuthLinkStatus,
  ProviderCredential,
  PublicAuthLinkAttempt
} from "./types.js";
import { AuthLinkError, OBSERVED_AUTHORIZATION_PROFILE } from "./types.js";
import type { AuthLinkStore, CreateAuthAttemptRecord } from "./auth-link-store.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const ATTEMPT_ID = /^link_[A-Za-z0-9_-]{20,120}$/u;
const LEASE_MS = 60_000;
const TERMINAL = new Set<AuthLinkStatus>([
  "LINKED", "EXPIRED", "FAILED_TERMINAL", "REVOKED",
  "HANDOFF_OUTCOME_UNKNOWN", "POLL_OUTCOME_UNKNOWN"
]);

interface AuthRow {
  attempt_id: string;
  tenant_id: string;
  subject: string;
  status: AuthLinkStatus;
  expires_at_ms: number | null;
  /** Retained for the v1 column only; new challenge identifiers are encrypted. */
  upstream_attempt_id: string | null;
  upstream_attempt_envelope_json: string | null;
  credential_envelope_json: string | null;
  cleanup_envelope_json: string | null;
  handoff_in_flight: number;
  poll_in_flight: number;
  lease_expires_at_ms: number | null;
  revision: number;
}

export interface SqliteAuthLinkStoreOptions {
  now?: () => number;
  leaseMs?: number;
  vault: AuthLinkSecretVault;
}

/**
 * Durable AuthLinkStore adapter. It is intentionally opt-in: callers must
 * inject a vault, and no default runtime constructs this store. Ambiguous
 * in-flight work is converted to an explicit unknown state on reopen; it is
 * never retried automatically.
 */
export class SqliteAuthLinkStore implements AuthLinkStore {
  readonly #database: DatabaseSync;
  readonly #now: () => number;
  readonly #leaseMs: number;
  readonly #vault: AuthLinkSecretVault;
  #closed = false;

  constructor(databasePath: string, options: SqliteAuthLinkStoreOptions) {
    if (!options || typeof options.vault?.seal !== "function" || typeof options.vault.open !== "function") {
      throw new Error("AUTH_SECRET_VAULT_REQUIRED");
    }
    const safePath = prepareDatabasePath(databasePath);
    this.#now = options.now ?? Date.now;
    this.#leaseMs = options.leaseMs ?? LEASE_MS;
    if (!Number.isInteger(this.#leaseMs) || this.#leaseMs < 1_000 || this.#leaseMs > 10 * 60_000) {
      throw new Error("INVALID_AUTH_LEASE");
    }
    this.#vault = options.vault;
    this.#database = new DatabaseSync(safePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false
    });
    try {
      this.#configure(safePath !== ":memory:");
      this.#migrate();
      this.#recoverInFlight();
      if (safePath !== ":memory:") chmodSync(safePath, 0o600);
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }

  async createAttempt(input: CreateAuthAttemptRecord): Promise<PublicAuthLinkAttempt> {
    this.#assertOpen();
    validateAttemptId(input.attempt_id);
    validateBinding(input.binding);
    if (!Number.isSafeInteger(input.expires_at_ms) || input.expires_at_ms <= this.#now()) throw invalidState();
    return this.#tx(() => {
      const existing = this.#database.prepare("SELECT attempt_id FROM auth_link_attempts WHERE attempt_id = ?").get(input.attempt_id);
      if (existing) throw new AuthLinkError("INVALID_ATTEMPT_ID", "The generated authentication attempt id is unavailable.");
      this.#database.prepare(`INSERT INTO auth_link_attempts (
        attempt_id, tenant_id, subject, status, expires_at_ms,
        upstream_attempt_id, credential_envelope_json, handoff_in_flight,
        poll_in_flight, lease_expires_at_ms, revision
      ) VALUES (?, ?, ?, 'CHALLENGE_CREATED', ?, NULL, NULL, 0, 0, NULL, 0)`).run(
        input.attempt_id, input.binding.tenant_id, input.binding.subject, input.expires_at_ms
      );
      return this.#snapshot(this.#row(input.attempt_id)!);
    });
  }

  async beginHandoff(binding: AuthBinding, attemptId: string): Promise<void> {
    this.#mutate(binding, attemptId, (row) => {
      const retry = row.status === "FAILED_RETRYABLE" && row.upstream_attempt_id === null && row.upstream_attempt_envelope_json === null;
      if ((row.status !== "CHALLENGE_CREATED" && !retry) || row.handoff_in_flight) throw invalidState();
      this.#update(row, { status: "CHALLENGE_CREATED", handoff_in_flight: 1, lease_expires_at_ms: this.#now() + this.#leaseMs });
    });
  }

  async attachChallenge(binding: AuthBinding, attemptId: string, upstreamAttemptId: string): Promise<PublicAuthLinkAttempt> {
    validateOpaque(upstreamAttemptId);
    const envelope = await this.#vault.seal(validateBinding(binding), validateAttemptId(attemptId), upstreamAttemptId);
    return this.#mutate(binding, attemptId, (row) => {
      if (row.status !== "CHALLENGE_CREATED" || row.handoff_in_flight !== 1) throw invalidState();
      this.#update(row, { status: "HANDOFF_ISSUED", upstream_attempt_id: null, upstream_attempt_envelope_json: JSON.stringify(envelope), handoff_in_flight: 0, lease_expires_at_ms: null });
      return this.#snapshot(this.#row(row.attempt_id)!);
    });
  }

  async beginPoll(binding: AuthBinding, attemptId: string): Promise<string> {
    const poll = this.#mutate(binding, attemptId, (row) => {
      if (!["HANDOFF_ISSUED", "POLLING", "FAILED_RETRYABLE"].includes(row.status) || (!row.upstream_attempt_envelope_json && !row.upstream_attempt_id) || row.poll_in_flight) throw invalidState();
      const leaseExpiresAt = this.#now() + this.#leaseMs;
      this.#update(row, { status: "POLLING", poll_in_flight: 1, lease_expires_at_ms: leaseExpiresAt });
      return { envelopeJson: row.upstream_attempt_envelope_json, legacyAttemptId: row.upstream_attempt_id, leaseExpiresAt };
    });
    let upstreamAttemptId: string;
    if (poll.envelopeJson === null) {
      upstreamAttemptId = poll.legacyAttemptId!;
    } else {
      try {
        upstreamAttemptId = await this.#vault.open(validateBinding(binding), validateAttemptId(attemptId), parseEnvelope(poll.envelopeJson));
      } catch {
        this.#mutate(binding, attemptId, (row) => {
          if (row.status === "POLLING" && row.poll_in_flight === 1) this.#update(row, { status: "POLL_OUTCOME_UNKNOWN", poll_in_flight: 0, lease_expires_at_ms: null });
        });
        throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The stored challenge envelope is invalid.");
      }
    }
    const current = this.#tx(() => this.#requireBound(binding, attemptId));
    if (current.status !== "POLLING" || current.poll_in_flight !== 1 || current.lease_expires_at_ms !== poll.leaseExpiresAt || current.upstream_attempt_envelope_json !== poll.envelopeJson || current.upstream_attempt_id !== poll.legacyAttemptId) {
      throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The provider challenge is no longer available for polling.");
    }
    return upstreamAttemptId;
  }

  async markPending(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
    return this.#mutate(binding, attemptId, (row) => {
      if (row.status !== "POLLING" || row.poll_in_flight !== 1) throw invalidState();
      this.#update(row, { poll_in_flight: 0, lease_expires_at_ms: null });
      return this.#snapshot(this.#row(row.attempt_id)!);
    });
  }

  async markLinked(binding: AuthBinding, attemptId: string, credential: ProviderCredential): Promise<PublicAuthLinkAttempt> {
    if (credential?.scheme !== "Bearer" || typeof credential.value !== "string" || credential.value.length === 0) throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The provider credential is invalid.");
    // Seal before the transaction; plaintext is never passed into SQLite.
    const envelope = await this.#vault.seal(validateBinding(binding), validateAttemptId(attemptId), credential.value);
    return this.#mutate(binding, attemptId, (row) => {
      if (row.status !== "POLLING" || row.poll_in_flight !== 1) throw invalidState();
      this.#update(row, { status: "LINKED", expires_at_ms: null, upstream_attempt_id: null, upstream_attempt_envelope_json: null, credential_envelope_json: JSON.stringify(envelope), poll_in_flight: 0, lease_expires_at_ms: null });
      return this.#snapshot(this.#row(row.attempt_id)!);
    });
  }

  async markFailure(binding: AuthBinding, attemptId: string, retryable: boolean): Promise<PublicAuthLinkAttempt> {
    return this.#mutate(binding, attemptId, (row) => {
      if (TERMINAL.has(row.status)) return this.#snapshot(row);
      this.#update(row, { status: retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL", handoff_in_flight: 0, poll_in_flight: 0, lease_expires_at_ms: null, ...(retryable ? {} : { upstream_attempt_id: null, upstream_attempt_envelope_json: null, credential_envelope_json: null }) });
      return this.#snapshot(this.#row(row.attempt_id)!);
    });
  }

  async getSnapshot(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
    this.#assertOpen();
    return this.#tx(() => this.#snapshot(this.#requireBound(binding, attemptId)));
  }

  async revoke(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
    const envelopeJson = this.#mutate(binding, attemptId, (row) => {
      const pending = row.cleanup_envelope_json ?? row.credential_envelope_json;
      this.#update(row, { status: "REVOKED", expires_at_ms: null, upstream_attempt_id: null, upstream_attempt_envelope_json: null, credential_envelope_json: null, cleanup_envelope_json: pending, handoff_in_flight: 0, poll_in_flight: 0, lease_expires_at_ms: null });
      return pending;
    });
    if (envelopeJson !== null) {
      let envelope: AuthLinkSecretEnvelope;
      try { envelope = parseEnvelope(envelopeJson); }
      catch { throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The stored credential cleanup is pending because its envelope is invalid."); }
      try { await this.#vault.destroy(envelope); }
      catch { throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The credential is revoked but secure cleanup is still pending."); }
      this.#mutate(binding, attemptId, (row) => {
        if (row.status === "REVOKED" && row.cleanup_envelope_json === envelopeJson) this.#update(row, { cleanup_envelope_json: null });
      });
    }
    return this.getSnapshot(binding, attemptId);
  }

  async useCredential<T>(binding: AuthBinding, attemptId: string, use: (credential: ProviderCredential) => T | Promise<T>): Promise<T> {
    this.#assertOpen();
    const row = this.#tx(() => this.#requireBound(binding, attemptId));
    if (row.status !== "LINKED" || !row.credential_envelope_json) throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "No linked credential is available for this authentication attempt.");
    let envelope: AuthLinkSecretEnvelope;
    try { envelope = JSON.parse(row.credential_envelope_json) as AuthLinkSecretEnvelope; } catch { throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The stored credential envelope is invalid."); }
    const value = await this.#vault.open(validateBinding(binding), validateAttemptId(attemptId), envelope);
    const current = this.#tx(() => this.#requireBound(binding, attemptId));
    if (current.status !== "LINKED" || current.credential_envelope_json !== row.credential_envelope_json) throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "No linked credential is available for this authentication attempt.");
    return await use({ scheme: "Bearer", value });
  }

  close(): void { if (!this.#closed) { this.#database.close(); this.#closed = true; } }

  #mutate<T>(binding: AuthBinding, attemptId: string, work: (row: AuthRow) => T): T {
    this.#assertOpen();
    validateBinding(binding); validateAttemptId(attemptId);
    return this.#tx(() => work(this.#requireBound(binding, attemptId)));
  }

  #requireBound(binding: AuthBinding, attemptId: string): AuthRow {
    const safeBinding = validateBinding(binding); const safeId = validateAttemptId(attemptId);
    const row = this.#database.prepare("SELECT * FROM auth_link_attempts WHERE attempt_id = ? AND tenant_id = ? AND subject = ?").get(safeId, safeBinding.tenant_id, safeBinding.subject) as AuthRow | undefined;
    if (!row) throw new AuthLinkError("AUTH_LINK_NOT_FOUND", "The authentication attempt is not available for this principal.");
    if ((row.handoff_in_flight === 1 || row.poll_in_flight === 1) && (row.lease_expires_at_ms === null || row.lease_expires_at_ms <= this.#now())) {
      this.#update(row, row.handoff_in_flight === 1
        ? { status: "HANDOFF_OUTCOME_UNKNOWN", handoff_in_flight: 0, lease_expires_at_ms: null }
        : { status: "POLL_OUTCOME_UNKNOWN", poll_in_flight: 0, lease_expires_at_ms: null });
      return this.#row(row.attempt_id)!;
    }
    if (row.expires_at_ms !== null && row.expires_at_ms <= this.#now() && !TERMINAL.has(row.status)) {
      this.#update(row, { status: "EXPIRED", expires_at_ms: null, upstream_attempt_id: null, upstream_attempt_envelope_json: null, credential_envelope_json: null, handoff_in_flight: 0, poll_in_flight: 0, lease_expires_at_ms: null });
      return this.#row(row.attempt_id)!;
    }
    return row;
  }

  #update(row: AuthRow, values: Partial<AuthRow>): void {
    const entries = Object.entries(values);
    if (entries.length === 0) return;
    const sets = entries.map(([key]) => `${key} = ?`).join(", ");
    const valuesList = entries.map(([, value]) => value);
    const result = this.#database.prepare(`UPDATE auth_link_attempts SET ${sets}, revision = revision + 1 WHERE attempt_id = ? AND tenant_id = ? AND subject = ? AND revision = ?`).run(...valuesList, row.attempt_id, row.tenant_id, row.subject, row.revision);
    if (Number(result.changes) !== 1) throw invalidState();
  }

  #row(id: string): AuthRow | null { return (this.#database.prepare("SELECT * FROM auth_link_attempts WHERE attempt_id = ?").get(id) as AuthRow | undefined) ?? null; }
  #snapshot(row: AuthRow): PublicAuthLinkAttempt { return { attempt_id: row.attempt_id, authorization_profile: OBSERVED_AUTHORIZATION_PROFILE, status: row.status, expires_at: row.expires_at_ms === null ? null : new Date(row.expires_at_ms).toISOString(), linked: row.status === "LINKED" }; }
  #tx<T>(work: () => T): T { this.#database.exec("BEGIN IMMEDIATE"); try { const result = work(); this.#database.exec("COMMIT"); return result; } catch (error) { try { this.#database.exec("ROLLBACK"); } catch {} throw error; } }
  #assertOpen(): void { if (this.#closed) throw invalidState(); }

  #configure(fileBacked: boolean): void {
    this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    const mode = String((this.#database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string }).journal_mode ?? "").toLowerCase();
    const sync = Number((this.#database.prepare("PRAGMA synchronous").get() as { synchronous?: number }).synchronous);
    if ((fileBacked && mode !== "wal") || sync !== 2) throw new Error("SQLITE_SAFETY_PRAGMAS_FAILED");
  }

  #migrate(): void {
    this.#database.exec(`CREATE TABLE IF NOT EXISTS auth_link_store_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;`);
    const current = Number((this.#database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM auth_link_store_migrations").get() as { version?: number }).version ?? 0);
    if (current > 2) throw new Error("UNSUPPORTED_AUTH_SCHEMA_VERSION");
    if (current < 1) {
      this.#database.exec(`CREATE TABLE auth_link_attempts (
        attempt_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('CHALLENGE_CREATED','HANDOFF_ISSUED','POLLING','HANDOFF_OUTCOME_UNKNOWN','POLL_OUTCOME_UNKNOWN','LINKED','EXPIRED','FAILED_RETRYABLE','FAILED_TERMINAL','REVOKED')),
        expires_at_ms INTEGER,
        upstream_attempt_id TEXT,
        credential_envelope_json TEXT,
        handoff_in_flight INTEGER NOT NULL CHECK (handoff_in_flight IN (0,1)),
        poll_in_flight INTEGER NOT NULL CHECK (poll_in_flight IN (0,1)),
        lease_expires_at_ms INTEGER,
        revision INTEGER NOT NULL CHECK (revision >= 0),
        UNIQUE (tenant_id, subject, attempt_id)
      ) STRICT; CREATE INDEX auth_link_owner ON auth_link_attempts (tenant_id, subject, attempt_id);`);
      this.#database.prepare("INSERT INTO auth_link_store_migrations(version, applied_at) VALUES (1, ?)").run(this.#now());
    }
    const migrated = Number((this.#database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM auth_link_store_migrations").get() as { version?: number }).version ?? 0);
    if (migrated < 2) {
      const legacy = this.#database.prepare("SELECT 1 FROM auth_link_attempts WHERE upstream_attempt_id IS NOT NULL LIMIT 1").get();
      if (legacy) throw new Error("AUTH_SCHEMA_MIGRATION_REQUIRED");
      this.#database.exec("ALTER TABLE auth_link_attempts ADD COLUMN upstream_attempt_envelope_json TEXT; ALTER TABLE auth_link_attempts ADD COLUMN cleanup_envelope_json TEXT;");
      this.#database.prepare("INSERT INTO auth_link_store_migrations(version, applied_at) VALUES (2, ?)").run(this.#now());
    }
  }

  #recoverInFlight(): void {
    this.#tx(() => {
      const rows = this.#database.prepare("SELECT * FROM auth_link_attempts WHERE (handoff_in_flight = 1 OR poll_in_flight = 1) AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)").all(this.#now()) as unknown as AuthRow[];
      for (const row of rows) {
        this.#update(row, row.handoff_in_flight === 1 ? { status: "HANDOFF_OUTCOME_UNKNOWN", handoff_in_flight: 0, lease_expires_at_ms: null } : { status: "POLL_OUTCOME_UNKNOWN", poll_in_flight: 0, lease_expires_at_ms: null });
      }
    });
  }
}

function validateBinding(binding: AuthBinding): AuthBinding {
  if (!binding || typeof binding.tenant_id !== "string" || typeof binding.subject !== "string" || !SAFE_ID.test(binding.tenant_id) || !SAFE_ID.test(binding.subject)) throw new AuthLinkError("INVALID_AUTH_BINDING", "A valid tenant and authenticated subject are required.");
  return binding;
}
function validateAttemptId(id: string): string { if (typeof id !== "string" || !ATTEMPT_ID.test(id)) throw new AuthLinkError("INVALID_ATTEMPT_ID", "The authentication attempt id is invalid."); return id; }
function validateOpaque(value: string): void { if (typeof value !== "string" || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) throw new AuthLinkError("MALFORMED_PROVIDER_RESPONSE", "The upstream attempt identifier is invalid."); }
function parseEnvelope(value: string): AuthLinkSecretEnvelope { try { const parsed = JSON.parse(value) as AuthLinkSecretEnvelope; if (parsed.schema_version !== "1.0.0" || parsed.algorithm !== "aes-256-gcm" || typeof parsed.key_handle !== "string") throw new Error(); return parsed; } catch { throw new AuthLinkError("AUTH_CREDENTIAL_UNAVAILABLE", "The stored credential envelope is invalid."); } }
function invalidState(): AuthLinkError { return new AuthLinkError("AUTH_LINK_INVALID_STATE", "The authentication attempt cannot perform that transition."); }
function prepareDatabasePath(databasePath: string): string {
  if (databasePath === ":memory:") return databasePath;
  if (typeof databasePath !== "string" || databasePath.length === 0 || databasePath.includes("\0")) throw new Error("UNSAFE_AUTH_DATABASE_PATH");
  const absolute = resolve(databasePath); const parent = dirname(absolute);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent); if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) !== 0) throw new Error("UNSAFE_AUTH_DATABASE_PATH");
  try { const fd = openSync(absolute, "wx", 0o600); closeSync(fd); } catch (error) { if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST")) throw error; }
  const stat = lstatSync(absolute); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("UNSAFE_AUTH_DATABASE_PATH");
  chmodSync(absolute, 0o600); return absolute;
}
