import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { openPrivateOwnerAuthProfile } from "../src/auth/private-owner-auth-profile.js";
import { createDurableOwnerGenerationRuntime } from "../src/runtime/durable-owner-generation-runtime.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";
import { assertBorrowedOwnerProfileLease, createPrivateOwnerGenerationProfile, type BorrowedOwnerProfileLease } from "../src/runtime/private-owner-generation-profile.js";

function createProfileFixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-generation-profile-"));
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

function fakeAuthProvider(): AuthLinkProvider {
  return {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "fake-profile-challenge", approval_url: "https://t.me/syntxaibot" }; },
    async pollChallenge(_challengeId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-profile-token" });
      return { state: "LINKED" };
    }
  };
}

test("auth profile returns an immutable lease borrow bound to its path, store, and binding", (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture(t);
  const authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  t.after(() => authProfile.close());
  const borrow = authProfile.borrowGenerationLease();
  assert.equal(Object.isFrozen(borrow), true);
  assert.equal(borrow.profileDirectory, profileDirectory);
  assert.doesNotThrow(() => assertBorrowedOwnerProfileLease(borrow, profileDirectory, authProfile.store, authProfile.binding));
  assert.throws(() => assertBorrowedOwnerProfileLease(borrow, profileDirectory, {} as typeof authProfile.store, authProfile.binding),
    /OWNER_PROFILE_LEASE_CONTEXT_MISMATCH/u);
  assert.throws(() => assertBorrowedOwnerProfileLease(borrow, profileDirectory, authProfile.store, {
    tenant_id: "tenant_wrong_profile", subject: authProfile.binding.subject
  }), /OWNER_PROFILE_LEASE_CONTEXT_MISMATCH/u);

  const fakeBorrow = {
    profileDirectory,
    assertHeld() {}
  } as BorrowedOwnerProfileLease;
  assert.throws(() => assertBorrowedOwnerProfileLease(fakeBorrow, profileDirectory, authProfile.store, authProfile.binding),
    /OWNER_PROFILE_LEASE_BORROW_INVALID/u);
  assert.throws(() => assertBorrowedOwnerProfileLease(borrow, join(root, "other-profile"), authProfile.store, authProfile.binding),
    /OWNER_PROFILE_LEASE_PATH_MISMATCH/u);
  authProfile.close();
  assert.throws(() => borrow.assertHeld(), /OWNER_GENERATION_PROFILE_LEASE_LOST/u);
});

test("shared profile child closes generation SQLite without closing auth or releasing the single lease", async (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const keyBefore = readFileSync(keyFilePath);
  const authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  const attemptId = "link_private_generation_profile_attempt01";
  const now = 1_800_000_000_000;
  const linkService = new PerUserLinkService(fakeAuthProvider(), authProfile.store, { now: () => now, attemptIdGenerator: () => attemptId });
  await linkService.createAttempt(authProfile.binding);
  await linkService.issueHandoff(authProfile.binding, attemptId);
  assert.equal((await linkService.checkAttempt(authProfile.binding, attemptId)).status, "LINKED");
  const events: string[] = [];
  const authStore = authProfile.store;
  const originalAuthClose = authStore.close.bind(authStore);
  Object.defineProperty(authStore, "close", { value: () => { events.push("auth-store-close"); originalAuthClose(); } });
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    join(process.cwd(), "catalog")
  );
  const profile = await createPrivateOwnerGenerationProfile({
    authProfile,
    linkService,
    attemptId,
    catalog,
    registry,
    v2VariantSelections: [{ model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square" }],
    offlineSubscriptionReader: async () => { throw new Error("construction must not read subscription"); },
    offlineFetchImpl: async () => { throw new Error("construction must not access network"); },
    now: () => new Date(now),
    createTransactionStore(path) {
      const store = new SqliteGenerationTransactionStore(join(path, "generation.sqlite"), { now: () => new Date(now) });
      const originalClose = store.close.bind(store);
      return new Proxy(store, {
        get(target, property) {
          if (property === "close") return () => { events.push("generation-store-close"); originalClose(); };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  });
  assert.equal(profile.generationRuntime.mode, "OFFLINE_VALIDATION_ONLY");
  assert.equal(existsSync(join(profileDirectory, "auth-links.sqlite")), true);
  assert.equal(existsSync(join(profileDirectory, "generation.sqlite")), true);
  assert.equal(readFileSync(keyFilePath).equals(keyBefore), true, "composition never creates, exports, or rewrites the existing key");
  assert.throws(() => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }), /OWNER_GENERATION_PROFILE_ALREADY_RUNNING/u);

  profile.generationRuntime.close();
  assert.deepEqual(events, ["generation-store-close"]);
  assert.equal((await linkService.getStatus(authProfile.binding, attemptId)).status, "LINKED");
  profile.generationRuntime.assertLeaseHeld();
  assert.throws(() => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }), /OWNER_GENERATION_PROFILE_ALREADY_RUNNING/u);

  profile.close();
  assert.deepEqual(events, ["generation-store-close", "auth-store-close"], "generation store closes before auth vault teardown");
  assert.throws(() => profile.generationRuntime.assertLeaseHeld(), /OWNER_GENERATION_PROFILE_LEASE_LOST/u);
  const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  reopened.close();
});

test("missing existing key fails closed without creating a profile key", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-generation-missing-key-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "account-profile");
  const keyFilePath = join(root, "missing.key");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath }), /OWNER_AUTH_PROFILE_PATH_UNAVAILABLE/u);
  assert.equal(existsSync(keyFilePath), false);
  assert.equal(existsSync(join(profileDirectory, ".syntx-owner-generation.lock")), false);
});

test("durable child rejects fake and cross-profile lease borrows before opening resources", async (t) => {
  const { root, profileDirectory, keyFilePath } = createProfileFixture(t);
  const authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  t.after(() => authProfile.close());
  const otherProfileDirectory = join(root, "other-profile");
  mkdirSync(otherProfileDirectory, { mode: 0o700 });
  chmodSync(otherProfileDirectory, 0o700);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  let authContexts = 0;
  let transactionStores = 0;
  const createAuthContext = () => { authContexts += 1; throw new Error("must fail before auth-context open"); };
  const createTransactionStore = () => { transactionStores += 1; throw new Error("must fail before database open"); };
  const fakeBorrow = { profileDirectory, assertHeld() {} } as BorrowedOwnerProfileLease;
  await assert.rejects(createDurableOwnerGenerationRuntime({
    profileDirectory, borrowedOwnerProfileLease: fakeBorrow, createAuthContext, createTransactionStore, catalog
  }), /OWNER_PROFILE_LEASE_BORROW_INVALID/u);
  const genuineBorrow = authProfile.borrowGenerationLease();
  await assert.rejects(createDurableOwnerGenerationRuntime({
    profileDirectory: otherProfileDirectory, borrowedOwnerProfileLease: genuineBorrow,
    createAuthContext, createTransactionStore, catalog
  }), /OWNER_PROFILE_LEASE_PATH_MISMATCH/u);
  assert.equal(authContexts, 0);
  assert.equal(transactionStores, 0);
  authProfile.close();
});

test("partial generation-store initialization closes only the owned shared profile and releases its lock", async (t) => {
  const { profileDirectory, keyFilePath } = createProfileFixture(t);
  const authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  const attemptId = "link_partial_generation_profile_attempt01";
  const linkService = new PerUserLinkService(fakeAuthProvider(), authProfile.store, { attemptIdGenerator: () => attemptId });
  await assert.rejects(createPrivateOwnerGenerationProfile({
    authProfile,
    linkService,
    attemptId,
    catalog,
    createTransactionStore() { throw new Error("synthetic generation SQLite open failure"); }
  }), /synthetic generation SQLite open failure/u);
  await assert.rejects(authProfile.store.getSnapshot(authProfile.binding, attemptId),
    (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "AUTH_LINK_INVALID_STATE");
  assert.equal(existsSync(join(profileDirectory, "generation.sqlite")), false);
  const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  reopened.close();
});
