#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeSync, fsyncSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIRM_FLAG = "--confirm-owner-auth-restart-smoke";
const FAKE_ONLY_FLAG = "--fake-only";
const REAL_MODE_FLAG = "--real";
const HANDOFF_FLAG = "--handoff-json";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const OWNER_STDIO_SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const PROFILE_LOCK_FILENAME = ".syntx-owner-generation.lock";
const DATABASE_FILENAME = "auth-links.sqlite";
const TOTAL_DEADLINE_MS = 3 * 60_000;
const HANDOFF_ACK_TIMEOUT_MS = 45_000;
const PENDING_LOGIN_POLL_INTERVAL_MS = 2_500;
const MAX_PENDING_LOGIN_POLLS = 48;
const CHILD_EXIT_TIMEOUT_MS = 12_000;
const LEASE_WAIT_TIMEOUT_MS = 5_000;
const MCP_TIMEOUT_MS = 12_000;
const AUDIT_KEYS = Object.freeze([
  "auth_start_count", "auth_token_poll_count", "balance_read_count",
  "subscription_read_count", "unexpected_request_count"
]);
const validatedConfigs = new WeakSet();

export function parseOwnerAuthRestartSmokeArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 3 || argv[0] !== CONFIRM_FLAG || argv[2] !== HANDOFF_FLAG) return null;
  const mode = argv[1] === FAKE_ONLY_FLAG ? "FAKE_OWNER_AUTH_RESTART" : argv[1] === REAL_MODE_FLAG ? "REAL_OWNER_AUTH_RESTART" : null;
  if (mode === null) return null;
  const config = Object.freeze({ mode });
  validatedConfigs.add(config);
  return config;
}

/** Owner auth restart harness with separately gated fake-only and REAL modes. */
export async function runOwnerAuthRestartSmoke(config, io = process, dependencies = {}) {
  if (config === null || typeof config !== "object" || !validatedConfigs.has(config)) {
    throw new Error("The owner-auth restart profile is not allowed.");
  }
  const isFakeOnly = config.mode === "FAKE_OWNER_AUTH_RESTART";
  const privateIpc = dependencies.sendPrivateIpc ?? io.sendPrivateIpc;
  if (!isFakeOnly && typeof privateIpc !== "function") throw new Error("OWNER_AUTH_RESTART_PRIVATE_IPC_REQUIRED");

  const deadline = createDeadline(TOTAL_DEADLINE_MS, dependencies.now);
  let fixture = null;
  let fixtureCreated = false;
  let fixtureCleanupStatus = "NOT_CREATED";
  let firstSession = null;
  let secondSession = null;
  let firstChildExitObserved = false;
  let secondChildExitObserved = false;
  let firstLeaseAbsent = false;
  let secondLeaseAbsent = false;
  let beginAttemptId = null;
  let beginAcknowledged = false;
  let sameAttemptRetained = false;
  let accountReadPass = false;
  let unlinkRevokedReadback = false;
  let fakeUpstreamBoundaryPass = false;
  let status = "FAILED";
  let mayCleanupFixture = false;

  try {
    const createOwnerClient = dependencies.createOwnerClient ?? await createDefaultOwnerClientFactory(config.mode);
    fixture = await (dependencies.createPrivateFixture ?? (() => createPrivateOwnerAuthRestartFixture(config.mode)))();
    fixtureCreated = true;
    if (!isFakeOnly && !await sendPrivateHandoff(privateIpc, { event: "FIXTURE_CREATED", profile_directory: fixture.profileDirectory }, deadline.signal, Math.min(HANDOFF_ACK_TIMEOUT_MS, remaining(deadline)))) {
      status = "PRIVATE_IPC_UNKNOWN";
      throw new Error("OWNER_AUTH_RESTART_PRIVATE_IPC_UNKNOWN");
    }

    firstSession = await createOwnerClient(fixture, 1, deadline);
    const begun = await callMcp(firstSession.client, "syntx_begin_login", {}, deadline);
    beginAttemptId = readAttemptId(begun);
    const handoffUri = readHandoffUri(begun);
    if (begun?.isError === true || beginAttemptId === null || !(isFakeOnly ? isSafeSyntheticHandoffUri(handoffUri) : isSafeOwnerHandoffUri(handoffUri))) {
      status = "BEGIN_OUTCOME_UNKNOWN";
    } else {
      if (isFakeOnly) {
        io.stdout.write(`${JSON.stringify({ event: "BEGIN", handoff: "synthetic" })}\n`);
        beginAcknowledged = await (dependencies.waitForHandoffAck ?? waitForHandoffAck)(io.stdin, deadline.signal, Math.min(HANDOFF_ACK_TIMEOUT_MS, remaining(deadline)));
      } else {
        const sent = await sendPrivateHandoff(privateIpc, { event: "BEGIN", attempt_id: beginAttemptId, handoff_uri: handoffUri }, deadline.signal, Math.min(HANDOFF_ACK_TIMEOUT_MS, remaining(deadline)));
        if (!sent) status = "HANDOFF_IPC_UNKNOWN";
        else beginAcknowledged = await (dependencies.waitForPrivateIpcAck ?? waitForPrivateIpcAck)(io, deadline.signal, Math.min(HANDOFF_ACK_TIMEOUT_MS, remaining(deadline)));
      }
      if (!beginAcknowledged) {
        if (status !== "HANDOFF_IPC_UNKNOWN") status = "HANDOFF_NOT_CONFIRMED";
      } else {
        const polled = isFakeOnly
          ? { outcome: "SINGLE_READ", result: await callMcp(firstSession.client, "syntx_check_login", { attempt_id: beginAttemptId }, deadline) }
          : await pollLoginUntilLinked(firstSession.client, beginAttemptId, deadline, dependencies);
        const linked = polled.result;
        if (polled.outcome === "POLL_UNKNOWN") status = "OUTCOME_UNKNOWN";
        else if (polled.outcome === "TERMINAL") status = "AUTH_NOT_LINKED";
        else if (polled.outcome === "PENDING_TIMEOUT") status = "OUTCOME_UNKNOWN";
        else if (polled.outcome !== "LINKED" && polled.outcome !== "SINGLE_READ") status = "OUTCOME_UNKNOWN";
        else if (!isExactAttemptState(linked, beginAttemptId, "LINKED", true)) {
          status = linked?.isError === true ? "OUTCOME_UNKNOWN" : "AUTH_NOT_LINKED";
        } else {
          const closeFirst = await closeOwnerClient(firstSession, CHILD_EXIT_TIMEOUT_MS);
          firstChildExitObserved = closeFirst;
          firstSession = null;
          if (!closeFirst) {
            status = "CHILD_EXIT_UNKNOWN";
          } else {
            firstLeaseAbsent = await (dependencies.waitForProfileLeaseAbsent ?? waitForProfileLeaseAbsent)(fixture, LEASE_WAIT_TIMEOUT_MS);
            if (!firstLeaseAbsent) {
              status = "LEASE_RELEASE_UNKNOWN";
            } else {
              secondSession = await createOwnerClient(fixture, 2, deadline);
              const retained = await callMcp(secondSession.client, "syntx_check_login", { attempt_id: beginAttemptId }, deadline);
              if (!isExactAttemptState(retained, beginAttemptId, "LINKED", true)) {
                status = retained?.isError === true ? "OUTCOME_UNKNOWN" : "RETAINED_ATTEMPT_MISMATCH";
              } else {
                sameAttemptRetained = true;
                const account = await callMcp(secondSession.client, "syntx_get_account_status", { link_attempt_id: beginAttemptId }, deadline);
                if (!isAccountReadSuccess(account)) {
                  status = account?.isError === true ? "OUTCOME_UNKNOWN" : "ACCOUNT_READ_FAILED";
                } else {
                  accountReadPass = true;
                  const revoked = await callMcp(secondSession.client, "syntx_unlink", { attempt_id: beginAttemptId }, deadline);
                  if (!isExactAttemptState(revoked, beginAttemptId, "REVOKED", false)) {
                    status = revoked?.isError === true ? "OUTCOME_UNKNOWN" : "UNLINK_OUTCOME_UNKNOWN";
                  } else {
                    const readback = await callMcp(secondSession.client, "syntx_check_login", { attempt_id: beginAttemptId }, deadline);
                    if (!isExactAttemptState(readback, beginAttemptId, "REVOKED", false)) {
                      status = readback?.isError === true ? "OUTCOME_UNKNOWN" : "REVOKED_READBACK_FAILED";
                    } else {
                      unlinkRevokedReadback = true;
                      const closeSecond = await closeOwnerClient(secondSession, CHILD_EXIT_TIMEOUT_MS);
                      secondChildExitObserved = closeSecond;
                      secondSession = null;
                      if (!closeSecond) {
                        status = "CHILD_EXIT_UNKNOWN";
                      } else {
                        secondLeaseAbsent = await (dependencies.waitForProfileLeaseAbsent ?? waitForProfileLeaseAbsent)(fixture, LEASE_WAIT_TIMEOUT_MS);
                        if (!secondLeaseAbsent) {
                          status = "LEASE_RELEASE_UNKNOWN";
                        } else {
                          if (isFakeOnly) {
                            const audit = await (dependencies.readFakeUpstreamAudit ?? readFakeUpstreamAudit)(fixture);
                            fakeUpstreamBoundaryPass = isExactFakeAudit(audit);
                            status = fakeUpstreamBoundaryPass ? "PASS" : "FAKE_UPSTREAM_BOUNDARY_FAILED";
                            mayCleanupFixture = fakeUpstreamBoundaryPass;
                          } else {
                            status = "PASS";
                            mayCleanupFixture = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (error?.fixtureCreated === true) fixtureCreated = true;
    if (status === "FAILED") status = beginAttemptId === null ? "FAILED" : "OUTCOME_UNKNOWN";
  } finally {
    deadline.cancel();
    if (firstSession !== null) {
      firstChildExitObserved = await closeOwnerClient(firstSession, CHILD_EXIT_TIMEOUT_MS);
      firstSession = null;
    }
    if (secondSession !== null) {
      secondChildExitObserved = await closeOwnerClient(secondSession, CHILD_EXIT_TIMEOUT_MS);
      secondSession = null;
    }
    if (fixtureCreated && fixture !== null) {
      if (status === "PASS" && mayCleanupFixture && firstChildExitObserved && secondChildExitObserved && firstLeaseAbsent && secondLeaseAbsent && unlinkRevokedReadback) {
        const cleaned = await (dependencies.cleanupPrivateFixture ?? cleanupPrivateOwnerAuthRestartFixture)(fixture);
        fixtureCleanupStatus = cleaned ? "CLEANED" : "UNKNOWN";
        if (!cleaned) status = "FIXTURE_CLEANUP_UNKNOWN";
      } else {
        fixtureCleanupStatus = "RETAINED";
      }
    }
  }

  const summary = Object.freeze({
    status,
    one_begin_acknowledged: beginAcknowledged,
    same_attempt_retained: sameAttemptRetained,
    first_child_exit_observed: firstChildExitObserved,
    first_lease_absent: firstLeaseAbsent,
    account_read_pass: accountReadPass,
    unlink_revoked_readback: unlinkRevokedReadback,
    second_child_exit_observed: secondChildExitObserved,
    second_lease_absent: secondLeaseAbsent,
    fake_upstream_boundary_pass: fakeUpstreamBoundaryPass,
    fixture_cleanup_status: fixtureCleanupStatus,
    fixture_retained: fixtureCreated && fixtureCleanupStatus !== "CLEANED"
  });
  if (!isFakeOnly && fixtureCreated && fixture !== null && summary.fixture_retained) {
    await sendPrivateHandoff(privateIpc, { event: "FIXTURE_RETAINED", profile_directory: fixture.profileDirectory }, new AbortController().signal, 2_000);
  }
  if (!isFakeOnly) await sendPrivateHandoff(privateIpc, { event: "FINAL", ...summary }, new AbortController().signal, 2_000);
  return summary;
}

async function createDefaultOwnerClientFactory(mode) {
  if (!existsSync(OWNER_STDIO_SERVER_PATH)) throw new Error("OWNER_STDIO_BUILD_UNAVAILABLE");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  return async (fixture, childIndex) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [OWNER_STDIO_SERVER_PATH],
      cwd: PROJECT_ROOT,
      env: buildOwnerAuthRestartChildEnv(mode, fixture),
      stderr: "pipe"
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: `syntx-owner-auth-restart-${childIndex}`, version: "1.0.0" });
    await client.connect(transport);
    let resolveChildClose;
    const childClose = new Promise((resolvePromise) => { resolveChildClose = resolvePromise; });
    const priorOnClose = transport.onclose;
    transport.onclose = () => { try { priorOnClose?.(); } finally { resolveChildClose(true); } };
    return { client, waitForExit: () => waitPromise(childClose, CHILD_EXIT_TIMEOUT_MS) };
  };
}

export function buildOwnerAuthRestartChildEnv(mode, fixture) {
  const trusted = {
    SYNTX_OWNER_AUTH_PROFILE_DIRECTORY: fixture.profileDirectory,
    SYNTX_OWNER_AUTH_KEY_FILE: fixture.keyFilePath,
    SYNTX_OWNER_ACCOUNT_STATUS: "1"
  };
  if (mode === "FAKE_OWNER_AUTH_RESTART") {
    return Object.freeze({ ...trusted,
      SYNTX_OWNER_AUTH_RESTART_FAKE_AUDIT_FILE: fixture.auditFilePath,
      NODE_OPTIONS: `--import=${pathToFileURL(fixture.bootstrapFilePath).href}`
    });
  }
  if (mode === "REAL_OWNER_AUTH_RESTART") return Object.freeze(trusted);
  throw new Error("OWNER_AUTH_RESTART_MODE_INVALID");
}

async function createPrivateOwnerAuthRestartFixture(mode) {
  const uid = currentUid();
  const home = resolveCanonicalHome(uid);
  const profileDirectory = join(home, `.syntx-owner-auth-restart-${randomBytes(16).toString("hex")}`);
  mkdirSync(profileDirectory, { mode: 0o700 });
  const keyFilePath = join(profileDirectory, "auth.key");
  const auditFilePath = mode === "FAKE_OWNER_AUTH_RESTART" ? join(profileDirectory, "fake-audit.json") : null;
  const bootstrapFilePath = mode === "FAKE_OWNER_AUTH_RESTART" ? join(profileDirectory, "fake-fetch.mjs") : null;
  const identities = new Map();
  try {
    const directoryIdentity = assertPrivateCreatedDirectory(profileDirectory, uid);
    const key = randomBytes(32);
    try { identities.set("auth.key", writeExclusiveFile(keyFilePath, key, 0o600, uid)); }
    finally { key.fill(0); }
    if (auditFilePath !== null && bootstrapFilePath !== null) {
      identities.set("fake-audit.json", writeExclusiveFile(auditFilePath, Buffer.from(JSON.stringify(emptyAudit()), "utf8"), 0o600, uid));
      identities.set("fake-fetch.mjs", writeExclusiveFile(bootstrapFilePath, Buffer.from(fakeFetchBootstrapSource(), "utf8"), 0o600, uid));
    }
    return Object.freeze({ mode, profileDirectory, keyFilePath, auditFilePath, bootstrapFilePath, identities, directoryIdentity, uid });
  } catch {
    const error = new Error("OWNER_AUTH_RESTART_FIXTURE_SETUP_FAILED");
    error.fixtureCreated = true;
    throw error;
  }
}

function resolveCanonicalHome(uid) {
  const home = realpathSync(homedir());
  const homeStat = lstatSync(home);
  if (homeStat.isSymbolicLink() || !homeStat.isDirectory() || homeStat.uid !== uid || (homeStat.mode & 0o022) !== 0 || isInsideProject(home)) throw new Error("OWNER_AUTH_RESTART_HOME_UNSAFE");
  let current = home;
  for (;;) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o022) !== 0) throw new Error("OWNER_AUTH_RESTART_HOME_ANCESTOR_UNSAFE");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return home;
}

function currentUid() {
  if (typeof process.getuid !== "function") throw new Error("OWNER_AUTH_RESTART_UID_UNAVAILABLE");
  return process.getuid();
}

function isInsideProject(path) {
  const relativePath = relative(PROJECT_ROOT, path);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

function assertPrivateCreatedDirectory(path, uid) {
  if (realpathSync(path) !== path) throw new Error("OWNER_AUTH_RESTART_PROFILE_NONCANONICAL");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || isInsideProject(path)) throw new Error("OWNER_AUTH_RESTART_PROFILE_UNSAFE");
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid };
}

function writeExclusiveFile(path, bytes, mode, uid) {
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o777) !== mode) throw new Error("OWNER_AUTH_RESTART_FILE_UNSAFE");
    let written = 0;
    while (written < bytes.length) written += writeSync(descriptor, bytes, written, bytes.length - written);
    fsyncSync(descriptor);
    return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777, uid: stat.uid };
  } finally { closeSync(descriptor); }
}

function fakeFetchBootstrapSource() {
  return `import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, writeSync, fsyncSync } from "node:fs";
import { randomUUID } from "node:crypto";
const auditPath = process.env.SYNTX_OWNER_AUTH_RESTART_FAKE_AUDIT_FILE;
const fakeToken = Buffer.alloc(32, 0x5a).toString("base64url");
function readAudit() { const stat = lstatSync(auditPath); if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new Error("FAKE_AUDIT_UNSAFE"); return JSON.parse(readFileSync(auditPath, "utf8")); }
function increment(name) { const audit = readAudit(); audit[name] += 1; const fd = openSync(auditPath, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW); try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new Error("FAKE_AUDIT_UNSAFE"); const bytes = Buffer.from(JSON.stringify(audit), "utf8"); let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset); fsyncSync(fd); } finally { closeSync(fd); } }
function json(value) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
globalThis.fetch = async (input, init = {}) => {
  let url; try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); } catch { increment("unexpected_request_count"); throw new Error("FAKE_UPSTREAM_ROUTE_DENIED"); }
  const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.origin !== "https://api.syntx.ai") { increment("unexpected_request_count"); throw new Error("FAKE_UPSTREAM_ROUTE_DENIED"); }
  if (url.pathname === "/api/v1/auth/startauth" && method === "POST" && url.search === "") { increment("auth_start_count"); return json({ uuid: randomUUID() }); }
  if (/^\\/api\\/v1\\/auth\\/token\\/[0-9a-f-]{36}$/iu.test(url.pathname) && method === "GET" && url.search === "") { increment("auth_token_poll_count"); return json({ valid: true, complete: true, token: fakeToken, is_new_user: false }); }
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (headers.get("authorization") !== "Bearer " + fakeToken) { increment("unexpected_request_count"); throw new Error("FAKE_UPSTREAM_AUTH_DENIED"); }
  if (url.pathname === "/api/v1/user/balance" && method === "GET" && url.search === "") { increment("balance_read_count"); return json({}); }
  if (url.pathname === "/api/v1/user/subscription" && method === "GET" && url.search === "?ref=false") { increment("subscription_read_count"); return json({ active: true, type: "OWNER_AUTH_RESTART_TEST", end_date: null }); }
  increment("unexpected_request_count"); throw new Error("FAKE_UPSTREAM_ROUTE_DENIED");
};
`;
}

function emptyAudit() {
  return { auth_start_count: 0, auth_token_poll_count: 0, balance_read_count: 0, subscription_read_count: 0, unexpected_request_count: 0 };
}

function readFakeUpstreamAudit(fixture) {
  try {
    assertPrivateFixtureFile(fixture.auditFilePath, fixture.uid, fixture.identities.get("fake-audit.json"));
    const audit = JSON.parse(readFileSync(fixture.auditFilePath, "utf8"));
    if (Object.keys(audit).sort().join("|") !== [...AUDIT_KEYS].sort().join("|") || AUDIT_KEYS.some((key) => !Number.isSafeInteger(audit[key]) || audit[key] < 0)) return null;
    return audit;
  } catch { return null; }
}

function isExactFakeAudit(audit) {
  return audit !== null && audit.auth_start_count === 1 && audit.auth_token_poll_count === 1 && audit.balance_read_count === 1 && audit.subscription_read_count === 1 && audit.unexpected_request_count === 0;
}

function isExactAttemptState(result, attemptId, status, linked) {
  const value = result?.structuredContent;
  return result?.isError !== true && value?.attempt_id === attemptId && value.status === status && value.linked === linked;
}

function isAccountReadSuccess(result) {
  const subscription = result?.structuredContent?.subscription;
  return result?.isError !== true && subscription !== null && typeof subscription === "object" && (subscription.active === true || subscription.active === false || subscription.active === null);
}

function readAttemptId(result) {
  const value = result?.structuredContent?.attempt_id;
  return typeof value === "string" && /^link_[A-Za-z0-9_-]{20,120}$/u.test(value) ? value : null;
}

function readHandoffUri(result) { return result?.content?.find((item) => item.type === "resource_link")?.uri ?? null; }

function isSafeSyntheticHandoffUri(value) {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/syntxaibot" && url.username === "" && url.password === "" && url.searchParams.size === 1 && /^auth_[0-9a-f-]{36}$/iu.test(url.searchParams.get("start") ?? ""); }
  catch { return false; }
}

function isSafeOwnerHandoffUri(value) {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const url = new URL(value);
    const start = url.searchParams.get("start") ?? "";
    return url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/syntxaibot" && url.username === "" && url.password === "" && url.searchParams.size === 1 && /^auth_[A-Za-z0-9_-]{1,256}$/u.test(start);
  } catch { return false; }
}

async function sendPrivateHandoff(send, message, signal, timeoutMs) {
  if (signal.aborted || timeoutMs <= 0) return false;
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolvePromise(value);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => send(message)).then((value) => finish(value !== false), () => finish(false));
  });
}

async function waitForPrivateIpcAck(io, signal, timeoutMs) {
  if (typeof io?.on !== "function" || typeof io?.off !== "function" || signal.aborted || timeoutMs <= 0) return false;
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); io.off("message", onMessage); signal.removeEventListener("abort", onAbort); resolvePromise(value); };
    const onMessage = (message) => finish(message !== null && typeof message === "object" && !Array.isArray(message) && Object.keys(message).length === 1 && message.action === "handoff_sent");
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.();
    io.on("message", onMessage); signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function callMcp(client, name, args, deadline) {
  if (deadline.signal.aborted || remaining(deadline) <= 0) throw new Error("OWNER_AUTH_RESTART_DEADLINE");
  const timeout = Math.min(MCP_TIMEOUT_MS, remaining(deadline));
  return client.callTool({ name, arguments: args }, undefined, { signal: deadline.signal, timeout, maxTotalTimeout: timeout });
}

async function pollLoginUntilLinked(client, attemptId, deadline, dependencies) {
  for (let poll = 0; poll < MAX_PENDING_LOGIN_POLLS; poll += 1) {
    if (deadline.signal.aborted || remaining(deadline) <= 0) return { outcome: "PENDING_TIMEOUT", result: null };
    let result;
    try { result = await callMcp(client, "syntx_check_login", { attempt_id: attemptId }, deadline); }
    catch { return { outcome: "POLL_UNKNOWN", result: null }; }
    if (result?.isError === true) return { outcome: "POLL_UNKNOWN", result };
    const value = result?.structuredContent;
    if (value?.attempt_id !== attemptId) return { outcome: "POLL_UNKNOWN", result };
    if (value.status === "LINKED" && value.linked === true) return { outcome: "LINKED", result };
    if (!["HANDOFF_ISSUED", "POLLING"].includes(value.status) || value.linked !== false) {
      return ["EXPIRED", "REVOKED", "FAILED_RETRYABLE", "FAILED_TERMINAL"].includes(value.status)
        ? { outcome: "TERMINAL", result }
        : { outcome: "POLL_UNKNOWN", result };
    }
    if (poll + 1 >= MAX_PENDING_LOGIN_POLLS) return { outcome: "PENDING_TIMEOUT", result };
    const waitMs = Math.min(PENDING_LOGIN_POLL_INTERVAL_MS, remaining(deadline));
    if (waitMs <= 0) return { outcome: "PENDING_TIMEOUT", result };
    const waited = await (dependencies.waitForLoginPollInterval ?? waitForLoginPollInterval)(waitMs, deadline.signal);
    if (waited === false || deadline.signal.aborted || remaining(deadline) <= 0) return { outcome: "PENDING_TIMEOUT", result };
  }
  return { outcome: "PENDING_TIMEOUT", result: null };
}

function waitForLoginPollInterval(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolvePromise(value); };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds); timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function closeOwnerClient(session, timeoutMs) {
  if (session.closed === true) return session.exitObserved === true;
  session.closed = true;
  try {
    await session.client.close();
    session.exitObserved = typeof session.waitForExit === "function" ? await session.waitForExit(timeoutMs) : false;
    return session.exitObserved === true;
  } catch { session.exitObserved = false; return false; }
}

async function waitForHandoffAck(input, signal, timeoutMs) {
  return new Promise((resolvePromise) => {
    let buffer = ""; let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); input.off("data", onData); input.off("end", onEnd); signal.removeEventListener("abort", onAbort); input.pause?.(); resolvePromise(value); };
    const onData = (chunk) => { buffer += String(chunk); if (Buffer.byteLength(buffer, "utf8") > 1_024) return finish(false); const newline = buffer.indexOf("\n"); if (newline < 0) return; const line = buffer.slice(0, newline).replace(/\r$/u, ""); if (buffer.slice(newline + 1).trim() !== "") return finish(false); try { const value = JSON.parse(line); finish(value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && value.action === "handoff_sent"); } catch { finish(false); } };
    const onEnd = () => finish(false); const onAbort = () => finish(false); const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.(); input.setEncoding?.("utf8"); input.on("data", onData); input.once("end", onEnd); signal.addEventListener("abort", onAbort, { once: true }); input.resume?.();
  });
}

async function waitForProfileLeaseAbsent(fixture, timeoutMs) {
  try { assertSameFixtureDirectory(fixture); } catch { return false; }
  const lockPath = join(fixture.profileDirectory, PROFILE_LOCK_FILENAME); const end = Date.now() + timeoutMs;
  for (;;) { try { lstatSync(lockPath); } catch (error) { if (error?.code === "ENOENT") return true; return false; } if (Date.now() >= end) return false; await delay(Math.min(100, end - Date.now())); }
}

async function readFakeUpstreamAuditDefault(fixture) { return readFakeUpstreamAudit(fixture); }

function cleanupPrivateOwnerAuthRestartFixture(fixture) {
  try {
    assertSameFixtureDirectory(fixture);
    try { lstatSync(join(fixture.profileDirectory, PROFILE_LOCK_FILENAME)); return false; } catch (error) { if (error?.code !== "ENOENT") return false; }
    const fakeFiles = fixture.mode === "FAKE_OWNER_AUTH_RESTART" ? ["fake-audit.json", "fake-fetch.mjs"] : [];
    const allowed = new Set(["auth.key", ...fakeFiles, DATABASE_FILENAME, DATABASE_FILENAME + "-wal", DATABASE_FILENAME + "-shm"]);
    const entries = readdirSync(fixture.profileDirectory);
    if (entries.some((name) => !allowed.has(name)) || !["auth.key", ...fakeFiles, DATABASE_FILENAME].every((name) => entries.includes(name))) return false;
    const names = [...fakeFiles, DATABASE_FILENAME + "-wal", DATABASE_FILENAME + "-shm", DATABASE_FILENAME, "auth.key"];
    for (const name of names) {
      const path = join(fixture.profileDirectory, name);
      try { lstatSync(path); } catch (error) { if (error?.code === "ENOENT" && (name.endsWith("-wal") || name.endsWith("-shm"))) continue; return false; }
      assertPrivateFixtureFile(path, fixture.uid, fixture.identities.get(name));
    }
    for (const name of names) {
      try { unlinkSync(join(fixture.profileDirectory, name)); } catch (error) { if (error?.code === "ENOENT" && (name.endsWith("-wal") || name.endsWith("-shm"))) continue; return false; }
    }
    assertSameFixtureDirectory(fixture);
    rmdirSync(fixture.profileDirectory);
    return true;
  } catch { return false; }
}

function assertSameFixtureDirectory(fixture) {
  const actual = assertPrivateCreatedDirectory(fixture.profileDirectory, fixture.uid);
  if (actual.dev !== fixture.directoryIdentity.dev || actual.ino !== fixture.directoryIdentity.ino) throw new Error("OWNER_AUTH_RESTART_PROFILE_CHANGED");
}

function assertPrivateFixtureFile(path, uid, expectedIdentity = undefined) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new Error("OWNER_AUTH_RESTART_FIXTURE_FILE_UNSAFE");
  if (expectedIdentity && (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino)) throw new Error("OWNER_AUTH_RESTART_FIXTURE_FILE_CHANGED");
}

function createDeadline(milliseconds, clock = Date.now) {
  const now = typeof clock === "function" ? clock : Date.now;
  const controller = new AbortController(); const expiresAt = now() + milliseconds;
  const timer = setTimeout(() => controller.abort(new Error("OWNER_AUTH_RESTART_DEADLINE")), milliseconds); timer.unref?.();
  return { signal: controller.signal, expiresAt, now, cancel: () => clearTimeout(timer) };
}

function remaining(deadline) { return Math.max(0, deadline.expiresAt - deadline.now()); }
function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
function waitPromise(promise, timeoutMs) { return Promise.race([promise, new Promise((resolvePromise) => { const timer = setTimeout(() => resolvePromise(false), timeoutMs); timer.unref?.(); })]); }

function isDirectInvocation() { return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; }

if (isDirectInvocation()) {
  const config = parseOwnerAuthRestartSmokeArgs(process.argv.slice(2));
  if (config === null) {
    process.stderr.write("Refusing owner-auth restart smoke. Select exactly " + CONFIRM_FLAG + " " + FAKE_ONLY_FLAG + "|" + REAL_MODE_FLAG + " " + HANDOFF_FLAG + "; REAL requires parent IPC.\n");
    process.exitCode = 2;
  } else {
    const sendPrivateIpc = typeof process.send === "function" ? (message) => new Promise((resolvePromise, reject) => process.send(message, (error) => error ? reject(error) : resolvePromise(true))) : undefined;
    const result = await runOwnerAuthRestartSmoke(config, process, { sendPrivateIpc }).catch(() => ({ status: "FAILED", one_begin_acknowledged: false, same_attempt_retained: false, first_child_exit_observed: false, first_lease_absent: false, account_read_pass: false, unlink_revoked_readback: false, second_child_exit_observed: false, second_lease_absent: false, fake_upstream_boundary_pass: false, fixture_cleanup_status: "NOT_CREATED", fixture_retained: false }));
    process.stdout.write(JSON.stringify(result) + "\n");
    if (result.status !== "PASS") process.exitCode = 1;
  }
}
