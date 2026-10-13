import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { openPrivateOwnerAuthProfile } from "../src/auth/private-owner-auth-profile.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createOwnerDurableSessionManager } from "../src/runtime/owner-durable-session-manager.js";
import type { GenerationJob } from "../src/domain/types.js";
import type { GenerationOperationRecord } from "../src/domain/generation-operation.js";
import type { GenerationTransactionStore } from "../src/storage/generation-transaction-store.js";
import { ApplicationError } from "../src/errors.js";

const ATTEMPT_ID = "link_owner_durable_session_manager_attempt01";
const SECOND_ATTEMPT_ID = "link_owner_durable_session_manager_attempt02";
const REGISTRY_VERSION = "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json";
const SELECTION = Object.freeze({
  model_id: "banana-2.1",
  operation_id: "generate-image",
  variant_id: "banana21-image-1k-minimal-square"
});

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-durable-session-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "profile");
  const keyFilePath = join(root, "account.key");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  writeFileSync(keyFilePath, Buffer.alloc(32, 23), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  return { profileDirectory, keyFilePath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function authProvider(): AuthLinkProvider {
  return {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-token" });
      return { state: "LINKED" };
    }
  };
}

async function linkedManager(
  t: TestContext,
  createContext?: (input: unknown) => unknown,
  options: {
    readonly includeRegistry?: boolean;
    readonly createTransactionStore?: () => GenerationTransactionStore;
    readonly managerCloseHook?: boolean;
  } = {}
) {
  const paths = fixture();
  const authProfile = openPrivateOwnerAuthProfile(paths);
  const linkService = new PerUserLinkService(authProvider(), authProfile.store, { attemptIdGenerator: () => ATTEMPT_ID });
  await linkService.createAttempt(authProfile.binding);
  await linkService.issueHandoff(authProfile.binding, ATTEMPT_ID);
  assert.equal((await linkService.checkAttempt(authProfile.binding, ATTEMPT_ID)).status, "LINKED");
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  const registry = options.includeRegistry === false ? undefined : loadGenerationContractRegistryV2(REGISTRY_VERSION, join(process.cwd(), "catalog"));
  const managerOptions = {
    authProfile, linkService, catalog,
    ...(registry === undefined ? {} : { registry }),
    ...(createContext === undefined ? {} : { createContext: createContext as never }),
    ...(options.createTransactionStore === undefined ? {} : { createTransactionStore: options.createTransactionStore })
  };
  const [manager, managerAgain] = await Promise.all([
    createOwnerDurableSessionManager(managerOptions),
    createOwnerDurableSessionManager(managerOptions)
  ]);
  assert.equal(managerAgain, manager, "concurrent same-profile initialization shares one manager lifetime");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  t.after(async () => {
    if (options.managerCloseHook !== false) await manager.close();
    paths.cleanup();
  });
  return { manager, catalogVersion, linkService, authProfile };
}

test("explicit trusted context exposes only its provided generation seam and guards it with linked lease", async (t) => {
  let startCalls = 0;
  let loseNextStart = false;
  let observedRequest: unknown;
  let observedKey: string | undefined;
  const { manager, catalogVersion, linkService, authProfile } = await linkedManager(t, () => ({
    readJob: async () => ({ id: "job", status: "queued" } as GenerationJob),
    readResult: async () => ({ job_id: "job", artifacts: [] } as never),
    executionMode: "TEST_FAKE" as const,
    startGeneration: async (request: unknown, idempotencyKey: string) => {
      startCalls += 1;
      await Promise.resolve();
      observedRequest = request;
      observedKey = idempotencyKey;
      if (loseNextStart) throw new ApplicationError("UPSTREAM_OUTCOME_UNKNOWN", "reconcile by operation id", { operation_id: "opaque-op" });
      return { id: "fake-job", status: "queued" } as GenerationJob;
    }
  }));
  const session = await manager.getContext(ATTEMPT_ID, SELECTION);
  assert.equal(session.mode, "TEST_FAKE", "local fake coverage must not be reported as a live owner call");
  assert.equal(typeof session.startGeneration, "function");
  const request = { model_id: SELECTION.model_id, operation_id: SELECTION.operation_id, catalog_version: catalogVersion, parameters: {} };
  await session.startGeneration!(request, "request-key-1");
  assert.equal(observedKey, "request-key-1");
  assert.equal(JSON.stringify(observedRequest), JSON.stringify(request));
  assert.equal(startCalls, 1);
  const mutableParameters = { nested: { values: [{ label: "before-await" }] } };
  const pendingStart = session.startGeneration!({ ...request, parameters: mutableParameters }, "request-key-snapshot");
  mutableParameters.nested.values[0]!.label = "mutated-after-call";
  await pendingStart;
  assert.equal(JSON.stringify((observedRequest as { parameters: unknown }).parameters),
    JSON.stringify({ nested: { values: [{ label: "before-await" }] } }));
  assert.equal(startCalls, 2);
  let accessorRead = false;
  const unsafeArray: unknown[] = [];
  Object.defineProperty(unsafeArray, "0", { enumerable: true, get() { accessorRead = true; return "unsafe"; } });
  unsafeArray.length = 1;
  await assert.rejects(session.startGeneration!({ ...request, parameters: { refs: unsafeArray } }, "request-key-accessor"),
    isManagerError("INVALID_SESSION_REQUEST"));
  assert.equal(accessorRead, false);
  assert.equal(startCalls, 2);
  const tooDeep: Record<string, unknown> = {};
  let nested = tooDeep;
  for (let index = 0; index < 10; index += 1) {
    const next: Record<string, unknown> = {};
    nested.child = next;
    nested = next;
  }
  await assert.rejects(session.startGeneration!({ ...request, parameters: { deep: tooDeep } }, "request-key-depth"),
    isManagerError("INVALID_SESSION_REQUEST"));
  assert.equal(startCalls, 2);
  loseNextStart = true;
  await assert.rejects(session.startGeneration!(request, "request-key-unknown"), (error: unknown) =>
    error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.equal(startCalls, 3);
  await linkService.revoke(authProfile.binding, ATTEMPT_ID);
  await assert.rejects(session.startGeneration!(request, "request-key-revoked"), isManagerError("OWNER_SESSION_NOT_LINKED"));
  assert.equal(startCalls, 3);
  await manager.close();
  await assert.rejects(session.startGeneration!(request, "request-key-2"), isManagerError("OWNER_SESSION_CLOSED"));
  assert.equal(startCalls, 3);
});

test("persisted GET uses exact owner row without requiring a current V2 registry", async (t) => {
  const jobId = "job-expected";
  let readCalls = 0;
  const store = {
    recoverInterruptedOperations: () => ({ recovered_count: 0, records: [] }),
    recoverInterruptedCancelAttempts: () => ({ recovered_count: 0, records: [] }),
    getById: (owner: { tenant_id: string; subject_id: string }, requestedJobId: string) => {
      if (requestedJobId === jobId) {
        return { id: jobId, principal: { tenant_id: owner.tenant_id, subject_id: owner.subject_id, connection_id: ATTEMPT_ID }, revision: 3 } as GenerationOperationRecord;
      }
      const foreignPrincipal = requestedJobId === "job-foreign-connection"
        ? { tenant_id: owner.tenant_id, subject_id: owner.subject_id, connection_id: SECOND_ATTEMPT_ID }
        : requestedJobId === "job-foreign-tenant"
          ? { tenant_id: "tenant-other", subject_id: owner.subject_id, connection_id: ATTEMPT_ID }
          : requestedJobId === "job-foreign-subject"
            ? { tenant_id: owner.tenant_id, subject_id: "subject-other", connection_id: ATTEMPT_ID }
            : null;
      return foreignPrincipal === null ? null : { id: requestedJobId, principal: foreignPrincipal, revision: 1 } as GenerationOperationRecord;
    },
    close() {}
  } as unknown as GenerationTransactionStore;
  let storeOpens = 0;
  const { manager } = await linkedManager(t, () => ({
    readJob: async (jobId: string) => { readCalls += 1; return { id: jobId, status: "queued" } as GenerationJob; },
    readResult: async (jobId: string) => ({ job_id: jobId, artifacts: [] } as never)
  }), { includeRegistry: false, createTransactionStore: () => { storeOpens += 1; return store; } });
  assert.equal(storeOpens, 1, "concurrent manager initialization opens exactly one shared generation store");
  assert.deepEqual(await manager.readJob(ATTEMPT_ID, jobId), { id: jobId, status: "queued" });
  assert.equal(readCalls, 1);
  await assert.rejects(manager.readJob(ATTEMPT_ID, "job-other-owner"), isManagerError("OWNER_SESSION_NOT_FOUND"));
  assert.equal(readCalls, 1);
  for (const foreignId of ["job-foreign-connection", "job-foreign-tenant", "job-foreign-subject"]) {
    await assert.rejects(manager.readJob(ATTEMPT_ID, foreignId), isManagerError("OWNER_SESSION_NOT_FOUND"));
  }
  assert.equal(readCalls, 1, "foreign known rows are rejected before adapter GET");
});

test("close drains pending context creation, invalidates existing contexts, and closes owned resources despite child close failure", async (t) => {
  const events: string[] = [];
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let resolvePending!: (context: unknown) => void;
  const pendingContext = new Promise<unknown>((resolve) => { resolvePending = resolve; });
  const fakeStore = {
    recoverInterruptedOperations: () => ({ recovered_count: 0, records: [] }),
    recoverInterruptedCancelAttempts: () => ({ recovered_count: 0, records: [] }),
    close() { events.push("generation-store"); }
  } as unknown as GenerationTransactionStore;
  const { manager, authProfile } = await linkedManager(t, (input) => {
    const attemptId = (input as { attempt_id: string }).attempt_id;
    if (attemptId === SECOND_ATTEMPT_ID) {
      signalStarted();
      return pendingContext;
    }
    return { readJob: async () => ({ id: "job", status: "queued" } as GenerationJob),
      readResult: async () => ({ job_id: "job", artifacts: [] } as never),
      close() { events.push("existing-context"); } };
  }, { createTransactionStore: () => fakeStore, managerCloseHook: false });
  const authClose = authProfile.store.close.bind(authProfile.store);
  Object.defineProperty(authProfile.store, "close", { value: () => { events.push("auth-profile"); authClose(); } });
  const borrowedLease = authProfile.borrowGenerationLease();
  const existing = await manager.getContext(ATTEMPT_ID, SELECTION);
  const secondLinks = new PerUserLinkService(authProvider(), authProfile.store, { attemptIdGenerator: () => SECOND_ATTEMPT_ID });
  await secondLinks.createAttempt(authProfile.binding);
  await secondLinks.issueHandoff(authProfile.binding, SECOND_ATTEMPT_ID);
  await secondLinks.checkAttempt(authProfile.binding, SECOND_ATTEMPT_ID);
  const pending = manager.getContext(SECOND_ATTEMPT_ID, SELECTION);
  await started;
  const closing = manager.close();
  resolvePending({ readJob: async () => ({ id: "job", status: "queued" } as GenerationJob),
    readResult: async () => ({ job_id: "job", artifacts: [] } as never),
    close() { events.push("pending-context"); throw new Error("private test failure"); } });
  await assert.rejects(pending, isManagerError("OWNER_SESSION_CLOSED"));
  await assert.rejects(closing, isManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE"));
  assert.deepEqual(events, ["pending-context", "existing-context", "generation-store", "auth-profile"]);
  await assert.rejects(existing.readJob("job"), isManagerError("OWNER_SESSION_CLOSED"));
  assert.throws(() => borrowedLease.assertHeld(), /OWNER_GENERATION_PROFILE_LEASE_LOST/u);
});

test("failed manager initialization closes only its owned store then auth profile", async (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const authProfile = openPrivateOwnerAuthProfile(paths);
  const events: string[] = [];
  const borrowedLease = authProfile.borrowGenerationLease();
  const authClose = authProfile.store.close.bind(authProfile.store);
  Object.defineProperty(authProfile.store, "close", { value: () => { events.push("auth-profile"); authClose(); } });
  const failedStore = {
    recoverInterruptedOperations() { throw new Error("synthetic-recovery-failure"); },
    close() { events.push("generation-store"); }
  } as unknown as GenerationTransactionStore;
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  await assert.rejects(createOwnerDurableSessionManager({
    authProfile,
    linkService: {} as never,
    catalog,
    createTransactionStore: () => failedStore
  }), isManagerError("OWNER_SESSION_CONTEXT_UNAVAILABLE"));
  assert.deepEqual(events, ["generation-store", "auth-profile"]);
  assert.throws(() => borrowedLease.assertHeld(), /OWNER_GENERATION_PROFILE_LEASE_LOST/u);
});

function isManagerError(code: string) {
  return (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === code;
}

test("default context is explicitly offline and has no mutation port", async (t) => {
  const { manager } = await linkedManager(t);
  const session = await manager.getContext(ATTEMPT_ID, SELECTION);
  assert.equal(session.mode, "OFFLINE_VALIDATION_ONLY");
  assert.equal("startGeneration" in session, false);
});
