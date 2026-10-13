import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteAuthLinkStore } from "../src/auth/sqlite-auth-link-store.js";
import { NodeAeadAuthLinkSecretVault } from "../src/auth/auth-link-secret-vault.js";
import type { AuthLinkSecretVault } from "../src/auth/auth-link-secret-vault.js";

const binding = { tenant_id: "tenant_sqlite", subject: "subject_a" } as const;
const otherBinding = { tenant_id: "tenant_sqlite", subject: "subject_b" } as const;
const attempt = "link_sqlite_auth_attempt_000001";
const opaqueEnvelope = (value: string) => ({
  schema_version: "1.0.0" as const,
  algorithm: "aes-256-gcm" as const,
  key_handle: "test-key",
  nonce_b64: "bm9uY2U",
  ciphertext_b64: Buffer.from(value, "utf8").toString("base64url"),
  auth_tag_b64: "dGFn"
});

function vault(): AuthLinkSecretVault {
  return {
    async seal(_binding, _attemptId, secret) { return opaqueEnvelope(secret); },
    async open(_binding, _attemptId, envelope) { return Buffer.from(envelope.ciphertext_b64, "base64url").toString("utf8"); },
    async destroy() {}
  };
}

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "syntx-auth-store-")), "auth.sqlite");
}

test("SQLite auth store reopens in-flight handoff as unknown without retry", async () => {
  const path = dbPath();
  let now = 1_800_000_000_000;
  try {
    const first = new SqliteAuthLinkStore(path, { vault: vault(), now: () => now });
    await first.createAttempt({ attempt_id: attempt, binding, expires_at_ms: now + 300_000 });
    await first.beginHandoff(binding, attempt);
    const second = new SqliteAuthLinkStore(path, { vault: vault(), now: () => now + 1 });
    assert.equal((await second.getSnapshot(binding, attempt)).status, "CHALLENGE_CREATED");
    second.close();
    now += 60_001;
    assert.equal((await first.getSnapshot(binding, attempt)).status, "HANDOFF_OUTCOME_UNKNOWN");
    first.close();
    const reopened = new SqliteAuthLinkStore(path, { vault: vault(), now: () => now });
    const snapshot = await reopened.getSnapshot(binding, attempt);
    assert.equal(snapshot.status, "HANDOFF_OUTCOME_UNKNOWN");
    await assert.rejects(reopened.beginHandoff(binding, attempt), (error: unknown) => (error as { code?: string }).code === "AUTH_LINK_INVALID_STATE");
    reopened.close();
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store enforces tenant/subject isolation and revoke", async () => {
  const path = dbPath();
  try {
    const store = new SqliteAuthLinkStore(path, { vault: vault(), now: () => 1_800_000_000_000 });
    await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await assert.rejects(store.getSnapshot(otherBinding, attempt), (error: unknown) => (error as { code?: string }).code === "AUTH_LINK_NOT_FOUND");
    await store.beginHandoff(binding, attempt);
    await store.attachChallenge(binding, attempt, "upstream-attempt-a");
    await store.beginPoll(binding, attempt);
    await store.markLinked(binding, attempt, { scheme: "Bearer", value: "super-secret-token" });
    assert.equal(await store.useCredential(binding, attempt, (credential) => credential.value), "super-secret-token");
    const revoked = await store.revoke(binding, attempt);
    assert.equal(revoked.status, "REVOKED");
    await assert.rejects(store.useCredential(binding, attempt, () => "not-called"), (error: unknown) => (error as { code?: string }).code === "AUTH_CREDENTIAL_UNAVAILABLE");
    store.close();
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("super-secret-token"), false);
    assert.equal(statSync(path).mode & 0o077, 0);
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store reopens an AEAD envelope without plaintext", async () => {
  const path = dbPath();
  const key = new Uint8Array(32).fill(9);
  const makeVault = () => new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "reopen-key");
  try {
    const first = new SqliteAuthLinkStore(path, { vault: makeVault(), now: () => 1_800_000_000_000 });
    await first.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await first.beginHandoff(binding, attempt);
    await first.attachChallenge(binding, attempt, "upstream-attempt-reopen");
    await first.beginPoll(binding, attempt);
    await first.markLinked(binding, attempt, { scheme: "Bearer", value: "reopen-secret" });
    first.close();
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("reopen-secret"), false);
    const reopened = new SqliteAuthLinkStore(path, { vault: makeVault(), now: () => 1_800_000_000_001 });
    assert.equal(await reopened.useCredential(binding, attempt, (credential) => credential.value), "reopen-secret");
    reopened.close();
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store encrypts the provider challenge in the database and WAL", async () => {
  const path = dbPath();
  const challengeId = "challenge-secret-must-not-be-stored";
  const credential = "credential-secret-must-not-be-stored";
  const key = new Uint8Array(32).fill(11);
  const makeVault = () => new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "challenge-key");
  try {
    const store = new SqliteAuthLinkStore(path, { vault: makeVault(), now: () => 1_800_000_000_000 });
    await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await store.beginHandoff(binding, attempt);
    await store.attachChallenge(binding, attempt, challengeId);
    assert.equal(await store.beginPoll(binding, attempt), challengeId);
    await store.markLinked(binding, attempt, { scheme: "Bearer", value: credential });
    const persisted = [path, `${path}-wal`].map((file) => {
      try { return readFileSync(file).toString("latin1"); } catch { return ""; }
    }).join("\n");
    assert.equal(persisted.includes(challengeId), false);
    assert.equal(persisted.includes(credential), false);
    store.close();
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store does not release a credential revoked during decryption", async () => {
  const path = dbPath();
  const key = new Uint8Array(32).fill(12);
  const base = new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "race-key");
  let delayOpen = false;
  let signalOpen!: () => void;
  let releaseOpen!: () => void;
  const opened = new Promise<void>((resolve) => { signalOpen = resolve; });
  const gate = new Promise<void>((resolve) => { releaseOpen = resolve; });
  const delayedVault: AuthLinkSecretVault = {
    seal: (...args) => base.seal(...args),
    async open(...args) {
      if (delayOpen) { signalOpen(); await gate; }
      return base.open(...args);
    },
    destroy: (envelope) => base.destroy(envelope)
  };
  try {
    const store = new SqliteAuthLinkStore(path, { vault: delayedVault, now: () => 1_800_000_000_000 });
    await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await store.beginHandoff(binding, attempt);
    await store.attachChallenge(binding, attempt, "challenge-for-revoke-race");
    await store.beginPoll(binding, attempt);
    await store.markLinked(binding, attempt, { scheme: "Bearer", value: "credential-for-revoke-race" });
    delayOpen = true;
    let callbackCalled = false;
    const using = store.useCredential(binding, attempt, () => { callbackCalled = true; });
    await opened;
    await store.revoke(binding, attempt);
    releaseOpen();
    await assert.rejects(using, (error: unknown) => (error as { code?: string }).code === "AUTH_CREDENTIAL_UNAVAILABLE");
    assert.equal(callbackCalled, false);
    store.close();
  } finally { releaseOpen(); rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store does not release a challenge revoked during decryption", async () => {
  const path = dbPath();
  const key = new Uint8Array(32).fill(15);
  const base = new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "challenge-race-key");
  let signalOpen!: () => void;
  let releaseOpen!: () => void;
  const opened = new Promise<void>((resolve) => { signalOpen = resolve; });
  const gate = new Promise<void>((resolve) => { releaseOpen = resolve; });
  const delayedVault: AuthLinkSecretVault = {
    seal: (...args) => base.seal(...args),
    async open(...args) { signalOpen(); await gate; return base.open(...args); },
    destroy: (envelope) => base.destroy(envelope)
  };
  try {
    const store = new SqliteAuthLinkStore(path, { vault: delayedVault, now: () => 1_800_000_000_000 });
    await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await store.beginHandoff(binding, attempt);
    await store.attachChallenge(binding, attempt, "challenge-revoked-during-open");
    const polling = store.beginPoll(binding, attempt);
    await opened;
    await store.revoke(binding, attempt);
    releaseOpen();
    await assert.rejects(polling, (error: unknown) => (error as { code?: string }).code === "AUTH_CREDENTIAL_UNAVAILABLE");
    assert.equal((await store.getSnapshot(binding, attempt)).status, "REVOKED");
    store.close();
  } finally { releaseOpen(); rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store revokes access even when the stored credential envelope is corrupt", async () => {
  const path = dbPath();
  const key = new Uint8Array(32).fill(13);
  const makeVault = () => new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "corrupt-key");
  try {
    const store = new SqliteAuthLinkStore(path, { vault: makeVault(), now: () => 1_800_000_000_000 });
    await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await store.beginHandoff(binding, attempt);
    await store.attachChallenge(binding, attempt, "challenge-for-corrupt-envelope");
    await store.beginPoll(binding, attempt);
    await store.markLinked(binding, attempt, { scheme: "Bearer", value: "credential-for-corrupt-envelope" });
    const database = new DatabaseSync(path);
    database.prepare("UPDATE auth_link_attempts SET credential_envelope_json = ? WHERE attempt_id = ?").run("not-json", attempt);
    database.close();
    await assert.rejects(store.revoke(binding, attempt), (error: unknown) => (error as { code?: string }).code === "AUTH_CREDENTIAL_UNAVAILABLE");
    assert.equal((await store.getSnapshot(binding, attempt)).status, "REVOKED");
    await assert.rejects(store.useCredential(binding, attempt, () => "must-not-run"), (error: unknown) => (error as { code?: string }).code === "AUTH_CREDENTIAL_UNAVAILABLE");
    store.close();
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store keeps credential cleanup pending across restart", async () => {
  const path = dbPath();
  const key = new Uint8Array(32).fill(14);
  const base = new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "cleanup-key");
  const failingVault: AuthLinkSecretVault = {
    seal: (...args) => base.seal(...args),
    open: (...args) => base.open(...args),
    async destroy() { throw new Error("cleanup unavailable"); }
  };
  try {
    const store = new SqliteAuthLinkStore(path, { vault: failingVault, now: () => 1_800_000_000_000 });
    await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: 1_800_000_300_000 });
    await store.beginHandoff(binding, attempt);
    await store.attachChallenge(binding, attempt, "challenge-for-pending-cleanup");
    await store.beginPoll(binding, attempt);
    await store.markLinked(binding, attempt, { scheme: "Bearer", value: "credential-for-pending-cleanup" });
    await assert.rejects(store.revoke(binding, attempt), (error: unknown) => (error as { code?: string }).code === "AUTH_CREDENTIAL_UNAVAILABLE");
    store.close();

    const inspect = new DatabaseSync(path);
    const pending = inspect.prepare("SELECT status, credential_envelope_json, cleanup_envelope_json FROM auth_link_attempts WHERE attempt_id = ?").get(attempt) as { status: string; credential_envelope_json: string | null; cleanup_envelope_json: string | null };
    inspect.close();
    assert.equal(pending.status, "REVOKED");
    assert.equal(pending.credential_envelope_json, null);
    assert.notEqual(pending.cleanup_envelope_json, null);

    const reopened = new SqliteAuthLinkStore(path, { vault: base, now: () => 1_800_000_000_001 });
    assert.equal((await reopened.revoke(binding, attempt)).status, "REVOKED");
    reopened.close();
    const verify = new DatabaseSync(path);
    const cleared = verify.prepare("SELECT cleanup_envelope_json FROM auth_link_attempts WHERE attempt_id = ?").get(attempt) as { cleanup_envelope_json: string | null };
    verify.close();
    assert.equal(cleared.cleanup_envelope_json, null);
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});

test("SQLite auth store refuses legacy plaintext challenge migration without rewriting it", () => {
  const path = dbPath();
  const legacyChallenge = "legacy-plaintext-challenge";
  try {
    const database = new DatabaseSync(path);
    database.exec("CREATE TABLE auth_link_store_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;");
    database.prepare("INSERT INTO auth_link_store_migrations(version, applied_at) VALUES (1, 1)").run();
    database.exec(`CREATE TABLE auth_link_attempts (
      attempt_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT NOT NULL,
      status TEXT NOT NULL, expires_at_ms INTEGER, upstream_attempt_id TEXT,
      credential_envelope_json TEXT, handoff_in_flight INTEGER NOT NULL,
      poll_in_flight INTEGER NOT NULL, lease_expires_at_ms INTEGER,
      revision INTEGER NOT NULL, UNIQUE (tenant_id, subject, attempt_id)
    ) STRICT;`);
    database.prepare("INSERT INTO auth_link_attempts VALUES (?, ?, ?, 'HANDOFF_ISSUED', NULL, ?, NULL, 0, 0, NULL, 0)").run(attempt, binding.tenant_id, binding.subject, legacyChallenge);
    database.close();
    assert.throws(() => new SqliteAuthLinkStore(path, { vault: vault() }), /AUTH_SCHEMA_MIGRATION_REQUIRED/u);
    const verify = new DatabaseSync(path);
    const preserved = verify.prepare("SELECT upstream_attempt_id FROM auth_link_attempts WHERE attempt_id = ?").get(attempt) as { upstream_attempt_id: string };
    verify.close();
    assert.equal(preserved.upstream_attempt_id, legacyChallenge);
  } finally { rmSync(path, { force: true }); rmSync(join(path, "-wal"), { force: true }); rmSync(join(path, "-shm"), { force: true }); }
});
