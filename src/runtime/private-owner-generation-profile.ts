import type { AuthBinding } from "../auth/types.js";
import type { AuthLinkStore } from "../auth/auth-link-store.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { PrivateOwnerAuthProfile } from "../auth/private-owner-auth-profile.js";
import type { GenerationTransactionStore } from "../storage/generation-transaction-store.js";
import { SqliteGenerationTransactionStore } from "../storage/sqlite-generation-transaction-store.js";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import type { DurableOwnerGenerationRuntime, DurableOwnerGenerationRuntimeOptions, DurableOwnerRuntimeLease } from "./durable-owner-generation-runtime.js";

interface OwnedLeaseBinding {
  readonly profileDirectory: string;
}

interface BorrowedLeaseBinding extends OwnedLeaseBinding {
  readonly lease: DurableOwnerRuntimeLease;
  readonly authStore: AuthLinkStore;
  readonly binding: Readonly<AuthBinding>;
}

const ownedLeases = new WeakMap<object, OwnedLeaseBinding>();
const borrowedLeases = new WeakMap<object, BorrowedLeaseBinding>();
const PROFILE_LOCK_FILENAME = ".syntx-owner-generation.lock";

export interface BorrowedOwnerProfileLease {
  readonly profileDirectory: string;
  assertHeld(): void;
}

export interface PrivateOwnerGenerationProfileOptions extends Omit<DurableOwnerGenerationRuntimeOptions,
  "profileDirectory" | "createAuthContext" | "createTransactionStore" | "borrowedOwnerProfileLease"> {
  readonly authProfile: PrivateOwnerAuthProfile;
  readonly linkService: PerUserLinkService;
  readonly attemptId: string;
  readonly createTransactionStore?: (profileDirectory: string) => GenerationTransactionStore | Promise<GenerationTransactionStore>;
}

export interface PrivateOwnerGenerationProfile {
  readonly authProfile: PrivateOwnerAuthProfile;
  readonly generationRuntime: DurableOwnerGenerationRuntime;
  close(): void;
}

export function assertOwnerProfileDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error("OWNER_GENERATION_PROFILE_DIRECTORY_UNSAFE");
  }
}

/** The sole existing lease implementation shared by auth and generation profile stores. */
export function acquireOwnerProfileLease(profileDirectory: string): DurableOwnerRuntimeLease {
  const resolved = resolve(profileDirectory);
  assertOwnerProfileDirectory(resolved);
  const lockPath = join(resolved, PROFILE_LOCK_FILENAME);
  const token = `pid=${process.pid}\ninstance=${randomUUID()}\n`;
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("OWNER_GENERATION_PROFILE_ALREADY_RUNNING");
    }
    throw new Error("OWNER_GENERATION_PROFILE_LOCK_FAILED");
  }
  try {
    writeSync(descriptor, token);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  syncDirectory(resolved);

  let released = false;
  const assertHeld = () => {
    if (released) throw new Error("OWNER_GENERATION_PROFILE_LEASE_LOST");
    try {
      const stat = lstatSync(lockPath);
      if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0 || readFileSync(lockPath, "utf8") !== token) {
        throw new Error("OWNER_GENERATION_PROFILE_LEASE_LOST");
      }
    } catch { throw new Error("OWNER_GENERATION_PROFILE_LEASE_LOST"); }
  };
  const lease: DurableOwnerRuntimeLease = {
    assertHeld,
    release() {
      if (released) return;
      assertHeld();
      unlinkSync(lockPath);
      syncDirectory(resolved);
      released = true;
    }
  };
  ownedLeases.set(lease, Object.freeze({ profileDirectory: resolved }));
  return lease;
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function assertLeaseRegistered(lease: DurableOwnerRuntimeLease, profileDirectory: string): OwnedLeaseBinding {
  const canonicalPath = resolve(profileDirectory);
  if (canonicalPath !== profileDirectory || typeof lease?.assertHeld !== "function" || typeof lease?.release !== "function") {
    throw new Error("OWNER_PROFILE_LEASE_REGISTRATION_INVALID");
  }
  const existing = ownedLeases.get(lease);
  if (existing === undefined) throw new Error("OWNER_PROFILE_LEASE_REGISTRATION_INVALID");
  if (existing.profileDirectory !== canonicalPath) throw new Error("OWNER_PROFILE_LEASE_REGISTRATION_CONFLICT");
  lease.assertHeld();
  return existing;
}

export function createBorrowedOwnerProfileLease(
  profileDirectory: string,
  lease: DurableOwnerRuntimeLease,
  authStore: AuthLinkStore,
  binding: AuthBinding
): BorrowedOwnerProfileLease {
  const canonicalPath = resolve(profileDirectory);
  const owned = assertLeaseRegistered(lease, canonicalPath);
  if (owned.profileDirectory !== canonicalPath || !authStore || !binding ||
      typeof binding.tenant_id !== "string" || typeof binding.subject !== "string") {
    throw new Error("OWNER_PROFILE_LEASE_BORROW_INVALID");
  }
  lease.assertHeld();
  let borrow!: BorrowedOwnerProfileLease;
  borrow = Object.freeze({
    profileDirectory: canonicalPath,
    assertHeld() {
      assertBorrowedOwnerProfileLease(borrow, canonicalPath, authStore, binding);
    }
  });
  borrowedLeases.set(borrow, Object.freeze({
    profileDirectory: canonicalPath,
    lease,
    authStore,
    binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject })
  }));
  return borrow;
}

export function assertBorrowedOwnerProfileLease(
  borrow: BorrowedOwnerProfileLease,
  expectedProfileDirectory: string,
  authStore?: AuthLinkStore,
  binding?: AuthBinding
): void {
  const record = borrow !== null && typeof borrow === "object" ? borrowedLeases.get(borrow) : undefined;
  const expectedPath = resolve(expectedProfileDirectory);
  if (!record) throw new Error("OWNER_PROFILE_LEASE_BORROW_INVALID");
  if (record.profileDirectory !== expectedPath || borrow.profileDirectory !== record.profileDirectory) {
    throw new Error("OWNER_PROFILE_LEASE_PATH_MISMATCH");
  }
  if ((authStore !== undefined && authStore !== record.authStore) ||
      (binding !== undefined && (binding.tenant_id !== record.binding.tenant_id || binding.subject !== record.binding.subject))) {
    throw new Error("OWNER_PROFILE_LEASE_CONTEXT_MISMATCH");
  }
  record.lease.assertHeld();
}

export async function createPrivateOwnerGenerationProfile(
  input: PrivateOwnerGenerationProfileOptions
): Promise<PrivateOwnerGenerationProfile> {
  const profileDirectory = input.authProfile.profileDirectory;
  const borrowedLease = input.authProfile.borrowGenerationLease();
  const { createTransactionStore: createTransactionStoreOverride, authProfile, linkService, attemptId, ...runtimeOptions } = input;
  const createTransactionStore = createTransactionStoreOverride ?? ((path: string) =>
    new SqliteGenerationTransactionStore(join(path, "generation.sqlite"), {
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  let generationRuntime: DurableOwnerGenerationRuntime;
  try {
    const { createDurableOwnerGenerationRuntime } = await import("./durable-owner-generation-runtime.js");
    generationRuntime = await createDurableOwnerGenerationRuntime({
      ...runtimeOptions,
      profileDirectory,
      borrowedOwnerProfileLease: borrowedLease,
      createAuthContext: () => ({ store: authProfile.store, linkService, binding: authProfile.binding, attemptId }),
      createTransactionStore
    });
  } catch (error) {
    try { authProfile.close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Private owner generation profile startup cleanup failed."); }
    throw error;
  }
  let closed = false;
  return Object.freeze({
    authProfile,
    generationRuntime,
    close() {
      if (closed) return;
      closed = true;
      const cleanupErrors: unknown[] = [];
      try { generationRuntime.close(); } catch (error) { cleanupErrors.push(error); }
      try { authProfile.close(); } catch (error) { cleanupErrors.push(error); }
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Private owner generation profile cleanup failed.");
    }
  });
}
