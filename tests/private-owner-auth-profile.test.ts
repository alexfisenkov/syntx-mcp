import assert from "node:assert/strict";
import { chmodSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { acquireLocalOwnerProfileLease } from "../src/runtime/durable-owner-generation-runtime.js";
import { closePrivateOwnerAuthProfileOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { withOmittedAuthArguments } from "../src/transports/omitted-auth-arguments.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import {
  OWNER_AUTH_KEY_FILE_ENV,
  OWNER_AUTH_PROFILE_DIRECTORY_ENV,
  openPrivateOwnerAuthProfile,
  resolvePrivateOwnerAuthProfileConfig
} from "../src/auth/private-owner-auth-profile.js";

function createProfileFixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-auth-profile-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "account-profile");
  const keyFilePath = join(root, "account.key");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  writeFileSync(keyFilePath, Buffer.alloc(32, 41), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, profileDirectory, keyFilePath };
}

test("private owner auth remains off without both trusted path settings and rejects partial configuration", () => {
  assert.equal(resolvePrivateOwnerAuthProfileConfig({}), null);
  assert.throws(
    () => resolvePrivateOwnerAuthProfileConfig({ [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: "/private/profile" }),
    /OWNER_AUTH_PROFILE_CONFIGURATION_INCOMPLETE/u
  );
  assert.throws(
    () => resolvePrivateOwnerAuthProfileConfig({ [OWNER_AUTH_KEY_FILE_ENV]: "/private/key" }),
    /OWNER_AUTH_PROFILE_CONFIGURATION_INCOMPLETE/u
  );
  assert.throws(
    () => resolvePrivateOwnerAuthProfileConfig({
      [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: "relative/profile",
      [OWNER_AUTH_KEY_FILE_ENV]: "relative/key"
    }),
    /OWNER_AUTH_PROFILE_PATH_INVALID/u
  );
});

test("private profile configuration rejects repo, root, control-character, symlink, hardlink and permission paths", (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture(t);
  const config = { profileDirectory, keyFilePath };
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: process.cwd(),
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_PATH_SCOPE_INVALID/u);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: "/",
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }));
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: `${profileDirectory}\n`,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_PATH_INVALID/u);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: `${profileDirectory}\0bad`,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_PATH_INVALID/u);

  const profileLink = join(root, "profile-link");
  symlinkSync(profileDirectory, profileLink);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileLink,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_PATH_SYMLINK/u);
  const linkedParent = join(root, "linked-parent");
  symlinkSync(root, linkedParent);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: join(linkedParent, "account-profile"),
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_PATH_SYMLINK/u);
  const keyLink = join(root, "key-link");
  symlinkSync(keyFilePath, keyLink);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: keyLink
  }), /OWNER_AUTH_PROFILE_PATH_SYMLINK/u);

  const hardLinkedKey = join(root, "hard-linked.key");
  linkSync(keyFilePath, hardLinkedKey);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_KEY_FILE_UNSAFE/u);
  rmSync(hardLinkedKey);

  const databasePath = join(profileDirectory, "auth-links.sqlite");
  symlinkSync(keyFilePath, databasePath);
  assert.throws(() => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }), /OWNER_AUTH_DATABASE_UNSAFE/u);
  rmSync(databasePath);
  const databaseHardlinkSource = join(root, "database-hardlink-source");
  writeFileSync(databaseHardlinkSource, "synthetic database bytes", { mode: 0o600 });
  chmodSync(databaseHardlinkSource, 0o600);
  linkSync(databaseHardlinkSource, databasePath);
  assert.throws(() => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }), /OWNER_AUTH_DATABASE_UNSAFE/u);
  rmSync(databasePath);
  rmSync(databaseHardlinkSource);

  chmodSync(keyFilePath, 0o640);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_KEY_FILE_UNSAFE/u);
  chmodSync(keyFilePath, 0o600);
  writeFileSync(keyFilePath, Buffer.alloc(31, 7), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_KEY_FILE_UNSAFE/u);
  writeFileSync(keyFilePath, Buffer.alloc(32, 41), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  chmodSync(profileDirectory, 0o750);
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_DIRECTORY_UNSAFE/u);
  chmodSync(profileDirectory, 0o700);
  assert.doesNotThrow(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: profileDirectory,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }));
  assert.equal(lstatSync(keyFilePath).nlink, 1);
  assert.notEqual(profileDirectory, process.cwd());
  assert.notEqual(config.profileDirectory, config.keyFilePath);
});

test("repository profile paths are rejected before any database is opened", (t) => {
  const { root, keyFilePath } = createProfileFixture(t);
  const insideRepository = mkdtempSync(join(process.cwd(), ".черновики", "owner-auth-scope-"));
  chmodSync(insideRepository, 0o700);
  t.after(() => rmSync(insideRepository, { recursive: true, force: true }));
  assert.throws(() => resolvePrivateOwnerAuthProfileConfig({
    [OWNER_AUTH_PROFILE_DIRECTORY_ENV]: insideRepository,
    [OWNER_AUTH_KEY_FILE_ENV]: keyFilePath
  }), /OWNER_AUTH_PROFILE_PATH_SCOPE_INVALID/u);
  assert.throws(() => lstatSync(join(insideRepository, "auth-links.sqlite")), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
  assert.notEqual(root, insideRepository);
});

test("persistent owner profile reopens the exact linked attempt without plaintext challenge or token", async (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const challenge = "synthetic-challenge-id-not-for-database";
  const credential = "synthetic-owner-token-not-for-database";
  const attemptId = "link_persistent_profile_attempt01";
  const now = 1_800_000_000_000;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: challenge, approval_url: "https://t.me/syntxaibot" }; },
    async pollChallenge(upstreamAttemptId, receiveCredential) {
      assert.equal(upstreamAttemptId, challenge);
      await receiveCredential({ scheme: "Bearer", value: credential });
      return { state: "LINKED" };
    }
  };
  const first = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  try {
    const service = new PerUserLinkService(provider, first.store, { now: () => now, attemptIdGenerator: () => attemptId });
    await service.createAttempt(first.binding);
    await service.issueHandoff(first.binding, attemptId);
    assert.equal((await service.checkAttempt(first.binding, attemptId)).status, "LINKED");
    assert.equal(await service.useCredential(first.binding, attemptId, (item) => item.value), credential);
    const persisted = [
      join(profileDirectory, "auth-links.sqlite"),
      join(profileDirectory, "auth-links.sqlite-wal")
    ].map((path) => { try { return readFileSync(path).toString("latin1"); } catch { return ""; } }).join("\n");
    assert.equal(persisted.includes(challenge), false);
    assert.equal(persisted.includes(credential), false);
  } finally { first.close(); }

  const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  try {
    assert.deepEqual(reopened.binding, first.binding);
    const secondFixture = createProfileFixture(t);
    const secondProfile = openPrivateOwnerAuthProfile(secondFixture);
    try { assert.notDeepEqual(secondProfile.binding, reopened.binding); }
    finally { secondProfile.close(); }
    const service = new PerUserLinkService(provider, reopened.store, { now: () => now + 1 });
    assert.equal((await service.getStatus(reopened.binding, attemptId)).status, "LINKED");
    assert.equal(await service.useCredential(reopened.binding, attemptId, (item) => item.value), credential);
    await assert.rejects(
      service.getStatus({ tenant_id: "tenant_foreign_profile", subject: "subject_foreign_profile" }, attemptId),
      (error: unknown) => (error as { code?: string }).code === "AUTH_LINK_NOT_FOUND"
    );

    let fetchCalls = 0;
    const runtime = createObservedOwnerRuntime({
      authStore: reopened.store,
      authBinding: reopened.binding,
      fetchImpl: async () => { fetchCalls += 1; throw new Error("Already-linked status check must not poll the provider."); }
    });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "persistent-owner-auth-reopen-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const status = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } });
      assert.equal(status.isError, undefined);
      assert.equal(JSON.stringify(status).includes(attemptId), true);
      assert.equal(fetchCalls, 0);
    } finally {
      await client.close();
      await server.close();
    }
  } finally { reopened.close(); }
});

test("real stdio EOF closes SQLite and releases the persistent profile lease", async (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const profile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  const input = new PassThrough();
  const output = new PassThrough();
  let originalCloseCalls = 0;
  const rawTransport = new StdioServerTransport(input, output);
  rawTransport.onclose = () => { originalCloseCalls += 1; };
  const transport = withOmittedAuthArguments(rawTransport);
  closePrivateOwnerAuthProfileOnTransportEof(transport, profile, input);
  const server = createMcpServer(createObservedOwnerRuntime().application);
  t.after(async () => {
    await server.close().catch(() => undefined);
    profile.close();
    input.destroy();
    output.destroy();
  });
  let protocolCloseCalls = 0;
  server.server.onclose = () => { protocolCloseCalls += 1; };
  await server.connect(transport);
  const inputEnded = new Promise<void>((resolve) => input.once("end", () => resolve()));
  input.end();
  await inputEnded;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(originalCloseCalls, 1);
  assert.equal(protocolCloseCalls, 1);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.listenerCount("error"), 0);
  input.emit("end");
  assert.equal(originalCloseCalls, 1);
  assert.equal(protocolCloseCalls, 1);
  await assert.rejects(profile.store.createAttempt({
    attempt_id: "link_after_eof_attempt01",
    binding: profile.binding,
    expires_at_ms: Date.now() + 60_000
  }));
  const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  reopened.close();
});

test("persistent owner stdio startup failure releases profile and removes stream listeners", async (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const envNames = [OWNER_AUTH_PROFILE_DIRECTORY_ENV, OWNER_AUTH_KEY_FILE_ENV] as const;
  const previous = envNames.map((name) => process.env[name]);
  process.env[OWNER_AUTH_PROFILE_DIRECTORY_ENV] = profileDirectory;
  process.env[OWNER_AUTH_KEY_FILE_ENV] = keyFilePath;
  t.after(() => {
    envNames.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  });

  const input = new PassThrough();
  const originalOn = input.on.bind(input);
  input.on = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === "data") throw new Error("synthetic stdio start failure");
    return originalOn(event as never, listener as never);
  }) as typeof input.on;
  t.after(() => input.destroy());

  await assert.rejects(runObservedOwnerStdioServer(input), /synthetic stdio start failure/u);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.listenerCount("error"), 0);
  const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  reopened.close();
});

test("private auth profile reuses the durable runtime lock name and release semantics", (t) => {
  const { profileDirectory } = createProfileFixture(t);
  const lease = acquireLocalOwnerProfileLease(profileDirectory);
  const lockPath = join(profileDirectory, ".syntx-owner-generation.lock");
  assert.equal(lstatSync(lockPath).mode & 0o077, 0);
  assert.throws(() => acquireLocalOwnerProfileLease(profileDirectory), /OWNER_GENERATION_PROFILE_ALREADY_RUNNING/u);
  lease.assertHeld();
  lease.release();
  assert.throws(() => lstatSync(lockPath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  const next = acquireLocalOwnerProfileLease(profileDirectory);
  next.release();
});

test("a second profile process is rejected before auth recovery and stale lock bytes are never deleted", async (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const first = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  try {
    const attemptId = "link_profile_lease_second_process01";
    const before = await first.store.createAttempt({
      attempt_id: attemptId,
      binding: first.binding,
      expires_at_ms: Date.now() + 60_000
    });
    assert.throws(
      () => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }),
      /OWNER_GENERATION_PROFILE_ALREADY_RUNNING/u
    );
    assert.deepEqual(await first.store.getSnapshot(first.binding, attemptId), before);
  } finally { first.close(); }

  const lockPath = join(profileDirectory, ".syntx-owner-generation.lock");
  const staleLock = "pid=1\ninstance=stale-owner-lock-fixture\n";
  writeFileSync(lockPath, staleLock, { mode: 0o600 });
  chmodSync(lockPath, 0o600);
  assert.throws(
    () => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }),
    /OWNER_GENERATION_PROFILE_ALREADY_RUNNING/u
  );
  assert.equal(readFileSync(lockPath, "utf8"), staleLock);
  assert.equal(lstatSync(join(profileDirectory, "auth-links.sqlite")).isFile(), true);
});

test("missing key and incompatible existing auth database fail closed without key replacement", (t) => {
  const missing = createProfileFixture(t);
  rmSync(missing.keyFilePath);
  assert.throws(() => openPrivateOwnerAuthProfile(missing));
  assert.equal(lstatSync(missing.profileDirectory).isDirectory(), true);
  assert.throws(() => lstatSync(join(missing.profileDirectory, "auth-links.sqlite")), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );

  const incompatible = createProfileFixture(t);
  const databasePath = join(incompatible.profileDirectory, "auth-links.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE auth_link_store_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;");
  database.prepare("INSERT INTO auth_link_store_migrations(version, applied_at) VALUES (99, 1)").run();
  database.close();
  chmodSync(databasePath, 0o600);
  const originalKey = readFileSync(incompatible.keyFilePath);
  assert.throws(() => openPrivateOwnerAuthProfile(incompatible), /UNSUPPORTED_AUTH_SCHEMA_VERSION/u);
  assert.deepEqual(readFileSync(incompatible.keyFilePath), originalKey, "startup never generates or replaces the operator key");
  assert.throws(() => lstatSync(join(incompatible.profileDirectory, ".syntx-owner-generation.lock")), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
});

test("private profile preserves and refuses a legacy database containing a plaintext challenge", (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const databasePath = join(profileDirectory, "auth-links.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE auth_link_store_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;");
  database.prepare("INSERT INTO auth_link_store_migrations(version, applied_at) VALUES (1, 1)").run();
  database.exec(`CREATE TABLE auth_link_attempts (
    attempt_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT NOT NULL,
    status TEXT NOT NULL, expires_at_ms INTEGER, upstream_attempt_id TEXT,
    credential_envelope_json TEXT, handoff_in_flight INTEGER NOT NULL,
    poll_in_flight INTEGER NOT NULL, lease_expires_at_ms INTEGER,
    revision INTEGER NOT NULL, UNIQUE (tenant_id, subject, attempt_id)
  ) STRICT;`);
  const legacyChallenge = "legacy-plaintext-challenge-must-not-migrate";
  database.prepare("INSERT INTO auth_link_attempts VALUES (?, ?, ?, 'HANDOFF_ISSUED', NULL, ?, NULL, 0, 0, NULL, 0)")
    .run("link_private_profile_legacy_attempt01", "tenant_legacy", "subject_legacy", legacyChallenge);
  database.close();
  chmodSync(databasePath, 0o600);
  assert.throws(() => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }), /AUTH_SCHEMA_MIGRATION_REQUIRED/u);
  const verify = new DatabaseSync(databasePath);
  const row = verify.prepare("SELECT upstream_attempt_id FROM auth_link_attempts WHERE attempt_id = ?")
    .get("link_private_profile_legacy_attempt01") as { upstream_attempt_id: string };
  verify.close();
  assert.equal(row.upstream_attempt_id, legacyChallenge);
  assert.throws(() => lstatSync(join(profileDirectory, ".syntx-owner-generation.lock")), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
});
