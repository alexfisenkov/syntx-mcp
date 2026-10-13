#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  realpathSync, rmdirSync, unlinkSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIRM_FLAG = "--confirm-owner-durable-restart-smoke";
const FAKE_ONLY_FLAG = "--fake-only";
const REAL_MODE_FLAG = "--real";
const HANDOFF_FLAG = "--handoff-json";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const OWNER_STDIO_SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const CONTRACT_VERSION = "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json";
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const JOB_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PROFILE_LOCK = ".syntx-owner-generation.lock";
const CHILD_TIMEOUT_MS = 15_000;
const REAL_RECOVERY_DEADLINE_MS = 10 * 60_000;
const REAL_RECOVERY_INTERVAL_MS = 2_500;
const configs = new WeakSet();

export function parseOwnerDurableRestartSmokeArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 3 || argv[0] !== CONFIRM_FLAG || argv[2] !== HANDOFF_FLAG) return null;
  const mode = argv[1] === FAKE_ONLY_FLAG ? "FAKE_OWNER_DURABLE_RESTART" : argv[1] === REAL_MODE_FLAG ? "REAL_OWNER_DURABLE_RESTART" : null;
  if (mode === null) return null;
  const config = Object.freeze({ mode });
  configs.add(config);
  return config;
}

export async function runOwnerDurableRestartSmoke(config, io = process, dependencies = {}) {
  if (config === null || typeof config !== "object" || !configs.has(config)) throw new Error("OWNER_DURABLE_RESTART_CONFIG_NOT_ALLOWED");
  if (config.mode === "REAL_OWNER_DURABLE_RESTART") {
    if (typeof (dependencies.sendPrivateIpc ?? io.sendPrivateIpc) !== "function") return summary("REAL_MODE_PRIVATE_IPC_REQUIRED");
    return runRealOwnerDurableRestartSmoke(io, dependencies);
  }
  let fixture = null;
  let first = null;
  let second = null;
  let attemptId = null;
  let jobId = null;
  let firstExit = false;
  let firstLeaseAbsent = false;
  let secondExit = false;
  let secondLeaseAbsent = false;
  let resultMetadata = null;
  let fakeBoundaryPass = false;
  let status = "FAILED";
  let cleanupStatus = "NOT_CREATED";
  try {
    if (!existsSync(OWNER_STDIO_SERVER_PATH)) return summary("OWNER_STDIO_BUILD_UNAVAILABLE");
    fixture = await (dependencies.createPrivateFixture ?? createPrivateFixture)("FAKE_OWNER_DURABLE_RESTART");
    const createChild = dependencies.createOwnerClient ?? createDefaultOwnerClient;
    first = await createChild(fixture, "FAKE_OWNER_DURABLE_RESTART");
    const firstTools = await first.client.listTools();
    assertRequiredTools(firstTools, true);
    const begun = decodeToolResult(await call(first.client, "syntx_begin_login", {}));
    attemptId = readAttemptId(begun);
    if (attemptId === null) throw new Error("FAKE_LINK_ATTEMPT_UNAVAILABLE");
    const linked = decodeToolResult(await call(first.client, "syntx_check_login", { attempt_id: attemptId }));
    if (linked?.attempt_id !== attemptId || linked.status !== "LINKED" || linked.linked !== true) throw new Error("FAKE_LINK_NOT_LINKED");
    const started = decodeToolResult(await call(first.client, "syntx_owner_start_durable_generation", {
      link_attempt_id: attemptId,
      model_id: "banana-2.1",
      operation_id: "generate-image",
      variant_id: "banana21-image-2k-medium-landscape",
      parameters: { prompt: "Synthetic owner durable restart fixture." },
      idempotency_key: `restart-${randomUUID()}`
    }));
    if (started?.error?.code === "UPSTREAM_OUTCOME_UNKNOWN") {
      jobId = readJobId(started);
      status = "HELD_UNKNOWN";
    } else {
      jobId = readJobId(started);
      if (jobId === null || started.status === undefined) throw new Error("FAKE_START_RECEIPT_UNAVAILABLE");
      status = "STARTED";
    }
    firstExit = await closeChild(first);
    first = null;
    firstLeaseAbsent = await waitForLeaseAbsent(fixture);
    if (!firstExit || !firstLeaseAbsent) throw new Error("FIRST_CHILD_CLOSE_UNCONFIRMED");
    if (jobId === null) return finish("HELD_UNKNOWN");
    second = await createChild(fixture, "FAKE_OWNER_DURABLE_RESTART");
    const secondTools = await second.client.listTools();
    assertRequiredTools(secondTools, false);
    const retained = decodeToolResult(await call(second.client, "syntx_check_login", { attempt_id: attemptId }));
    if (retained?.attempt_id !== attemptId || retained.status !== "LINKED" || retained.linked !== true) throw new Error("RETAINED_ATTEMPT_MISMATCH");
    const job = await readJobBounded(second.client, attemptId, jobId);
    if (status === "HELD_UNKNOWN") return finish("HELD_UNKNOWN");
    if (job?.id !== jobId || !["queued", "running", "succeeded", "failed", "canceled"].includes(job.status)) throw new Error("RECOVERY_JOB_UNAVAILABLE");
    if (job.status !== "succeeded") return finish("RECOVERY_PENDING");
    const result = decodeToolResult(await call(second.client, "syntx_owner_get_durable_result", { link_attempt_id: attemptId, job_id: jobId }));
    if (result?.job_id !== jobId || !Array.isArray(result.artifacts)) throw new Error("RECOVERY_RESULT_UNAVAILABLE");
    resultMetadata = { status: job.status, artifact_count: result.artifacts.length, mime_types: result.artifacts.map((item) => item.mime_type).filter((x) => typeof x === "string").sort() };
    secondExit = await closeChild(second);
    second = null;
    secondLeaseAbsent = await waitForLeaseAbsent(fixture);
    if (!secondExit || !secondLeaseAbsent) throw new Error("SECOND_CHILD_CLOSE_UNCONFIRMED");
    const audit = readFakeAudit(fixture.auditFilePath);
    fakeBoundaryPass = isExactFakeAudit(audit);
    if (!fakeBoundaryPass) throw new Error("FAKE_PROVIDER_BOUNDARY_FAILED");
    status = "PASS";
  } catch (error) {
    status = statusForError(error, status);
  } finally {
    if (first !== null) { firstExit = await closeChild(first); first = null; }
    if (second !== null) { secondExit = await closeChild(second); second = null; }
    if (fixture !== null) {
      cleanupStatus = status === "PASS" && firstExit && firstLeaseAbsent && secondExit && secondLeaseAbsent
        ? ((dependencies.cleanupPrivateFixture ?? cleanupPrivateFixture)(fixture) ? "CLEANED" : "UNKNOWN")
        : "RETAINED";
      if (cleanupStatus === "UNKNOWN" && status === "PASS") status = "FIXTURE_CLEANUP_UNKNOWN";
    }
  }
  return summary(status, { first_process_close_observed: firstExit, first_lease_absent: firstLeaseAbsent,
    second_process_close_observed: secondExit, second_lease_absent: secondLeaseAbsent,
    fixture_cleanup_status: cleanupStatus, fake_provider_boundary_pass: fakeBoundaryPass, result: resultMetadata });

  function finish(finalStatus) {
    status = finalStatus;
    return summary(status, { first_process_close_observed: firstExit, first_lease_absent: firstLeaseAbsent,
      second_process_close_observed: secondExit, second_lease_absent: secondLeaseAbsent,
      fixture_cleanup_status: "RETAINED", result: resultMetadata });
  }
}

export async function createDefaultOwnerClient(fixture, mode = "FAKE_OWNER_DURABLE_RESTART", sdk = {}) {
  const loaded = sdk.Client && sdk.StdioClientTransport ? null : await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const Client = sdk.Client ?? loaded[0].Client;
  const StdioClientTransport = sdk.StdioClientTransport ?? loaded[1].StdioClientTransport;
  const env = {
    SYNTX_OWNER_AUTH_PROFILE_DIRECTORY: fixture.profileDirectory,
    SYNTX_OWNER_AUTH_KEY_FILE: fixture.keyFilePath,
    SYNTX_OWNER_DURABLE_GENERATION: "1",
    SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0",
    SYNTX_GENERATION_CONTRACT_VERSION: CONTRACT_VERSION,
    ...(mode === "FAKE_OWNER_DURABLE_RESTART" ? { NODE_OPTIONS: `--import=${pathToFileURL(fixture.bootstrapFilePath).href}` } : {})
  };
  const transport = new StdioClientTransport({ command: process.execPath, args: [OWNER_STDIO_SERVER_PATH], cwd: PROJECT_ROOT, env, stderr: "pipe" });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "syntx-owner-durable-restart-smoke", version: "1.0.0" });
  let resolveExit;
  const exited = new Promise((resolvePromise) => { resolveExit = resolvePromise; });
  const priorOnClose = transport.onclose;
  transport.onclose = () => { try { priorOnClose?.(); } finally { resolveExit(true); } };
  try { await client.connect(transport); }
  catch {
    try { await transport.close(); } catch { throw new Error("OWNER_STDIO_STARTUP_AND_CLOSE_FAILED"); }
    throw new Error("OWNER_STDIO_STARTUP_FAILED");
  }
  return { client, transport, waitForExit: () => waitChildExit(exited, CHILD_TIMEOUT_MS) };
}

async function createPrivateFixture(mode = "FAKE_OWNER_DURABLE_RESTART") {
  const home = realpathSync(homedir());
  const profileDirectory = join(home, `.syntx-owner-durable-restart-${randomBytes(16).toString("hex")}`);
  mkdirSync(profileDirectory, { mode: 0o700 });
  const keyFilePath = join(profileDirectory, "auth.key");
  const bootstrapFilePath = mode === "FAKE_OWNER_DURABLE_RESTART" ? join(profileDirectory, "fake-provider.mjs") : null;
  const auditFilePath = mode === "FAKE_OWNER_DURABLE_RESTART" ? join(profileDirectory, "provider-audit.json") : null;
  const keyFd = openSync(keyFilePath, "wx", 0o600);
  try { writeFileSync(keyFd, randomBytes(32)); } finally { closeSync(keyFd); }
  if (bootstrapFilePath !== null && auditFilePath !== null) writeFileSync(bootstrapFilePath, fakeProviderBootstrap(auditFilePath), { mode: 0o600, flag: "wx" });
  assertPrivateFixture(profileDirectory, keyFilePath, bootstrapFilePath);
  return Object.freeze({ mode, profileDirectory, keyFilePath, bootstrapFilePath, auditFilePath });
}

function fakeProviderBootstrap(auditPath) {
  return `import { readFileSync, writeFileSync } from "node:fs";\n` +
`const auditPath = ${JSON.stringify(auditPath)};\n` +
`const zero = { auth_start: 0, auth_poll: 0, subscription_get: 0, model_access_get: 0, chat_create_post: 0, generation_post: 0, result_get: 0, unexpected: 0 };\n` +
`let counts = zero; try { const saved = JSON.parse(readFileSync(auditPath, "utf8")); if (Object.keys(zero).every((k) => Number.isSafeInteger(saved[k]) && saved[k] >= 0)) counts = saved; } catch {}\n` +
`const save = () => writeFileSync(auditPath, JSON.stringify(counts), { mode: 0o600 });\n` +
`const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });\n` +
`globalThis.fetch = async (input, init = {}) => { const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); const m = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(); const bump = (k) => { counts[k]++; save(); };\n` +
`if (u.origin !== "https://api.syntx.ai") { bump("unexpected"); throw new Error("FAKE_PROVIDER_ORIGIN_DENIED"); }\n` +
`if (u.pathname === "/api/v1/auth/startauth" && m === "POST") { bump("auth_start"); return json({ uuid: "00000000-0000-4000-8000-000000000062" }); }\n` +
`if (u.pathname === "/api/v1/auth/token/00000000-0000-4000-8000-000000000062" && m === "GET") { bump("auth_poll"); return json({ valid: true, complete: true, token: "synthetic-owner-durable-token", is_new_user: false }); }\n` +
`if (u.pathname === "/api/v1/user/subscription" && m === "GET") { bump("subscription_get"); return json({ active: true, type: "SYNTHETIC_FIXTURE" }); }\n` +
`if (u.pathname === "/api/v2/get_model_info" && m === "GET") { bump("model_access_get"); return json({ access: true, cost: null, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }); }\n` +
`if (u.pathname === "/api/v1/chats" && m === "POST") { bump("chat_create_post"); return json({ uuid: "synthetic-chat-62" }); }\n` +
`if (u.pathname === "/api/v1/design/generate" && m === "POST" && u.searchParams.get("ai_name") === "banana") { bump("generation_post"); return json({ id: "synthetic-message-62" }); }\n` +
`if (u.pathname === "/api/v1/chats/synthetic-chat-62/synthetic-message-62" && m === "GET") { bump("result_get"); return json({ id: "synthetic-message-62", author_id: -1, message_object: [{ id: "synthetic-object-62", object_type: "image", model_type: "banana-2.1", completed: true, object_url: "https://r2.syntx.ai/synthetic-62.jpg" }] }); }\n` +
`bump("unexpected"); throw new Error("FAKE_PROVIDER_ROUTE_DENIED"); };\n`;
}

function assertPrivateFixture(directory, keyFile, bootstrap) {
  const dir = lstatSync(directory);
  const key = lstatSync(keyFile);
  if (dir.isSymbolicLink() || !dir.isDirectory() || (dir.mode & 0o777) !== 0o700 || dir.uid !== process.getuid?.()) throw new Error("PRIVATE_FIXTURE_DIRECTORY_UNSAFE");
  if (key.isSymbolicLink() || !key.isFile() || key.nlink !== 1 || key.size !== 32 || (key.mode & 0o777) !== 0o600 || key.uid !== process.getuid?.()) throw new Error("PRIVATE_FIXTURE_KEY_UNSAFE");
  if (bootstrap !== null) {
    const shim = lstatSync(bootstrap);
    if (shim.isSymbolicLink() || !shim.isFile() || shim.nlink !== 1 || (shim.mode & 0o777) !== 0o600 || shim.uid !== process.getuid?.()) throw new Error("PRIVATE_FIXTURE_SHIM_UNSAFE");
  }
}

async function runRealOwnerDurableRestartSmoke(io, dependencies) {
  const send = dependencies.sendPrivateIpc ?? io.sendPrivateIpc;
  if (typeof io?.on !== "function" || typeof io?.off !== "function") return summary("REAL_MODE_PRIVATE_IPC_REQUIRED");
  let fixture = null;
  let first = null;
  let second = null;
  let attemptId = null;
  let jobId = null;
  let idempotencyKey = null;
  let firstExit = false;
  let firstLeaseAbsent = false;
  let secondExit = false;
  let secondLeaseAbsent = false;
  let resultMetadata = null;
  let status = "OUTCOME_UNKNOWN";
  try {
    if (!existsSync(OWNER_STDIO_SERVER_PATH)) throw new Error("OWNER_STDIO_BUILD_UNAVAILABLE");
    fixture = await (dependencies.createPrivateFixture ?? createPrivateFixture)("REAL_OWNER_DURABLE_RESTART");
    if (!await sendParent(send, { event: "FIXTURE_CREATED", profile_directory: fixture.profileDirectory })) throw new Error("PRIVATE_IPC_UNKNOWN");
    const createChild = dependencies.createOwnerClient ?? createDefaultOwnerClient;
    first = await createChild(fixture, "REAL_OWNER_DURABLE_RESTART");
    assertRequiredTools(await first.client.listTools(), true);
    const beginResponse = await call(first.client, "syntx_begin_login", {});
    const begun = decodeToolResult(beginResponse);
    attemptId = readAttemptId(begun);
    const handoffUri = readHandoffUri(beginResponse);
    if (attemptId === null || !isSafeOwnerHandoffUri(handoffUri)) throw new Error("BEGIN_OUTCOME_UNKNOWN");
    if (!await sendParent(send, { event: "BEGIN", attempt_id: attemptId, handoff_uri: handoffUri })) throw new Error("PRIVATE_IPC_UNKNOWN");
    if (!await waitParentAck(io, { action: "handoff_sent", attempt_id: attemptId }, 45_000)) throw new Error("HANDOFF_NOT_CONFIRMED");
    const link = await pollLinked(first.client, attemptId, dependencies);
    if (!link) throw new Error("LINK_OUTCOME_UNKNOWN");
    idempotencyKey = `owner-durable-${randomUUID()}`;
    if (!await sendParent(send, {
      event: "OWNER_INTENT", attempt_id: attemptId, model_id: "banana-2.1", operation_id: "generate-image",
      variant_id: "banana21-image-2k-medium-landscape", template_id: "banana21-image-2k-medium-landscape",
      parameters: { prompt: "A small red apple centered on a clean white background." },
      cost_disclosure: "OWNER_UNCAPPED; SYNTX may charge the account; no spending cap is enforceable.",
      idempotency_key: idempotencyKey
    })) throw new Error("PRIVATE_IPC_UNKNOWN");
    if (!await waitParentAck(io, { action: "generation_approved", idempotency_key: idempotencyKey }, 45_000)) throw new Error("GENERATION_NOT_CONFIRMED");
    let started = null;
    try {
      started = decodeToolResult(await call(first.client, "syntx_owner_start_durable_generation", {
        link_attempt_id: attemptId, model_id: "banana-2.1", operation_id: "generate-image",
        variant_id: "banana21-image-2k-medium-landscape",
        parameters: { prompt: "A small red apple centered on a clean white background." }, idempotency_key: idempotencyKey
      }));
    } catch {
      status = "HELD_UNKNOWN";
    }
    jobId = readJobId(started);
    if (started?.error?.code === "UPSTREAM_OUTCOME_UNKNOWN" || started === null) status = "HELD_UNKNOWN";
    else status = jobId === null ? "HELD_UNKNOWN" : "STARTED";
    await sendParent(send, {
      event: "RECOVERY_REFERENCE", attempt_id: attemptId, job_id: jobId,
      idempotency_key: idempotencyKey, start_state: status
    });
    firstExit = await closeChild(first);
    first = null;
    firstLeaseAbsent = await waitForLeaseAbsent(fixture);
    if (!firstExit || !firstLeaseAbsent) throw new Error("FIRST_CHILD_CLOSE_UNCONFIRMED");
    if (jobId === null) return await realFinish("HELD_UNKNOWN");
    second = await createChild(fixture, "REAL_OWNER_DURABLE_RESTART");
    assertRequiredTools(await second.client.listTools(), false);
    const retained = decodeToolResult(await call(second.client, "syntx_check_login", { attempt_id: attemptId }));
    if (retained?.attempt_id !== attemptId || retained.status !== "LINKED" || retained.linked !== true) throw new Error("RETAINED_ATTEMPT_MISMATCH");
    const recovery = await readJobUntilTerminal(second.client, attemptId, jobId, dependencies);
    const job = recovery.job;
    if (recovery.kind === "UNKNOWN" || job?.id !== jobId) return await realFinish("HELD_UNKNOWN", job?.status);
    if (recovery.kind === "PENDING") return await realFinish(status === "HELD_UNKNOWN" ? "HELD_UNKNOWN" : "RECOVERY_PENDING", job.status);
    if (job.status !== "succeeded") return await realFinish(status === "HELD_UNKNOWN" ? "HELD_UNKNOWN" : "RECOVERY_TERMINAL", job.status);
    const result = decodeToolResult(await call(second.client, "syntx_owner_get_durable_result", { link_attempt_id: attemptId, job_id: jobId }));
    if (result?.job_id !== jobId || !Array.isArray(result.artifacts)) return await realFinish("HELD_UNKNOWN");
    resultMetadata = { status: job.status, artifact_count: result.artifacts.length, mime_types: result.artifacts.map((item) => item.mime_type).filter((x) => typeof x === "string").sort() };
    secondExit = await closeChild(second);
    second = null;
    secondLeaseAbsent = await waitForLeaseAbsent(fixture);
    if (!secondExit || !secondLeaseAbsent) throw new Error("SECOND_CHILD_CLOSE_UNCONFIRMED");
    status = "PASS";
  } catch (error) {
    if (status !== "HELD_UNKNOWN") status = error?.message === "RETAINED_ATTEMPT_MISMATCH" ? "RETAINED_ATTEMPT_MISMATCH" : "OUTCOME_UNKNOWN";
  } finally {
    if (first !== null) { firstExit = await closeChild(first); first = null; }
    if (second !== null) { secondExit = await closeChild(second); second = null; }
  }
  const result = summary(status, {
    first_process_close_observed: firstExit, first_lease_absent: firstLeaseAbsent,
    second_process_close_observed: secondExit, second_lease_absent: secondLeaseAbsent,
    fixture_cleanup_status: fixture === null ? "NOT_CREATED" : "RETAINED", result: resultMetadata
  });
  await sendParent(send, { event: "FINAL", ...result });
  return result;

  async function realFinish(finalStatus, lastKnownJobStatus = undefined) {
    status = finalStatus;
    if (second !== null) {
      secondExit = await closeChild(second);
      second = null;
      secondLeaseAbsent = await waitForLeaseAbsent(fixture);
    }
    const output = summary(status, {
      first_process_close_observed: firstExit, first_lease_absent: firstLeaseAbsent,
      second_process_close_observed: secondExit, second_lease_absent: secondLeaseAbsent,
      fixture_cleanup_status: "RETAINED", result: resultMetadata,
      ...(lastKnownJobStatus === undefined ? {} : { last_known_job_status: lastKnownJobStatus })
    });
    await sendParent(send, { event: "FINAL", ...output });
    return output;
  }
}

async function pollLinked(client, attemptId, dependencies) {
  for (let poll = 0; poll < 48; poll += 1) {
    let linked;
    try { linked = decodeToolResult(await call(client, "syntx_check_login", { attempt_id: attemptId })); }
    catch { return false; }
    if (linked?.attempt_id !== attemptId) return false;
    if (linked.status === "LINKED" && linked.linked === true) return true;
    if (linked.status !== "HANDOFF_ISSUED" && linked.status !== "POLLING") return false;
    if (poll < 47 && (await (dependencies.waitForLoginPollInterval ?? delay)(2_500)) === false) return false;
  }
  return false;
}

function readHandoffUri(value) { return value?.content?.find((item) => item.type === "resource_link")?.uri ?? null; }

function isSafeOwnerHandoffUri(value) {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/syntxaibot" &&
      url.username === "" && url.password === "" && url.searchParams.size === 1 &&
      /^auth_[A-Za-z0-9_-]{1,256}$/u.test(url.searchParams.get("start") ?? "");
  } catch { return false; }
}

async function sendParent(send, message) {
  try { return (await send(message)) !== false; } catch { return false; }
}

function waitParentAck(io, expected, timeoutMs) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); io.off("message", onMessage); resolvePromise(value); };
    const onMessage = (message) => finish(message !== null && typeof message === "object" && !Array.isArray(message) &&
      Object.keys(message).length === Object.keys(expected).length && Object.keys(expected).every((key) => message[key] === expected[key]));
    const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.();
    io.on("message", onMessage);
  });
}

function cleanupPrivateFixture(fixture) {
  try {
    assertPrivateFixture(fixture.profileDirectory, fixture.keyFilePath, fixture.bootstrapFilePath);
    if (existsSync(join(fixture.profileDirectory, PROFILE_LOCK))) return false;
    const allowed = new Set(["auth.key", "fake-provider.mjs", "provider-audit.json", "auth-links.sqlite", "auth-links.sqlite-wal", "auth-links.sqlite-shm", "generation.sqlite", "generation.sqlite-wal", "generation.sqlite-shm"]);
    const entries = readdirSync(fixture.profileDirectory);
    if (entries.some((name) => !allowed.has(name)) || !["auth.key", "fake-provider.mjs", "auth-links.sqlite"].every((name) => entries.includes(name))) return false;
    for (const name of entries) {
      const path = join(fixture.profileDirectory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) return false;
    }
    for (const name of entries) unlinkSync(join(fixture.profileDirectory, name));
    rmdirSync(fixture.profileDirectory);
    return true;
  } catch { return false; }
}

function assertRequiredTools(result, includeStart) {
  const names = new Set(result?.tools?.map((tool) => tool.name) ?? []);
  const required = ["syntx_check_login", "syntx_owner_get_durable_job", "syntx_owner_get_durable_result"];
  if (includeStart) required.push("syntx_begin_login", "syntx_owner_start_durable_generation");
  if (required.some((name) => !names.has(name))) throw new Error("DURABLE_STDIO_TOOLS_UNAVAILABLE");
}

async function readJobBounded(client, attemptId, jobId) {
  for (let poll = 0; poll < 6; poll += 1) {
    const job = decodeToolResult(await call(client, "syntx_owner_get_durable_job", { link_attempt_id: attemptId, job_id: jobId }));
    if (job?.error) return job;
    if (job?.status === "succeeded" || job?.status === "failed" || job?.status === "canceled") return job;
    await delay(100);
  }
  return null;
}

async function readJobUntilTerminal(client, attemptId, jobId, dependencies) {
  const now = typeof dependencies.now === "function" ? dependencies.now : Date.now;
  const requestedDeadline = dependencies.recoveryDeadlineMs ?? REAL_RECOVERY_DEADLINE_MS;
  const deadlineMs = Number.isFinite(requestedDeadline) ? Math.max(0, Math.min(REAL_RECOVERY_DEADLINE_MS, requestedDeadline)) : REAL_RECOVERY_DEADLINE_MS;
  const expiresAt = now() + deadlineMs;
  const maxPolls = Math.max(1, Math.ceil(deadlineMs / REAL_RECOVERY_INTERVAL_MS) + 1);
  let polls = 0;
  let lastJob = null;
  while (polls < maxPolls && now() < expiresAt) {
    let job;
    try { job = decodeToolResult(await call(client, "syntx_owner_get_durable_job", { link_attempt_id: attemptId, job_id: jobId })); }
    catch { return { kind: "UNKNOWN", job: lastJob }; }
    polls += 1;
    if (job?.error || job?.id !== jobId || !["queued", "running", "succeeded", "failed", "canceled"].includes(job.status)) {
      return { kind: "UNKNOWN", job: lastJob };
    }
    lastJob = job;
    if (["succeeded", "failed", "canceled"].includes(job.status)) return { kind: "TERMINAL", job };
    const remaining = expiresAt - now();
    if (remaining <= 0 || polls >= maxPolls) break;
    const wait = dependencies.waitForRecoveryPollInterval ?? delay;
    if (await wait(Math.min(REAL_RECOVERY_INTERVAL_MS, remaining)) === false) break;
  }
  return { kind: "PENDING", job: lastJob };
}

function decodeToolResult(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string" || text.length > 16_384) return null;
  try { const parsed = JSON.parse(text); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; }
  catch { return null; }
}

function readAttemptId(value) { return typeof value?.attempt_id === "string" && ATTEMPT_PATTERN.test(value.attempt_id) ? value.attempt_id : null; }
function readJobId(value) { const jobId = value?.job_id ?? value?.error?.job_id; return typeof jobId === "string" && JOB_PATTERN.test(jobId) ? jobId : null; }
async function call(client, name, args) { return client.callTool({ name, arguments: args }, undefined, { timeout: CHILD_TIMEOUT_MS, maxTotalTimeout: CHILD_TIMEOUT_MS }); }

async function closeChild(session) {
  try { await session.client.close(); return await session.waitForExit(); } catch { return false; }
}

function waitChildExit(exited, timeoutMs) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    exited.then((value) => { clearTimeout(timer); resolvePromise(value); }, () => { clearTimeout(timer); resolvePromise(false); });
  });
}

async function waitForLeaseAbsent(fixture) {
  const lock = join(fixture.profileDirectory, PROFILE_LOCK);
  const expires = Date.now() + 5_000;
  do { try { lstatSync(lock); } catch (error) { if (error?.code === "ENOENT") return true; return false; } await delay(50); } while (Date.now() < expires);
  return false;
}

function summary(status, extra = {}) {
  const noRetry = status === "HELD_UNKNOWN" || status === "RECOVERY_PENDING" || status === "RECOVERY_TERMINAL";
  return Object.freeze({ status, no_retry: noRetry, fixture_retained: extra.fixture_cleanup_status !== undefined && extra.fixture_cleanup_status !== "CLEANED", ...extra });
}

function readFakeAudit(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function isExactFakeAudit(value) {
  return value !== null && value.auth_start === 1 && value.auth_poll === 1 && value.subscription_get === 1 &&
    value.model_access_get === 1 && value.chat_create_post === 1 && value.generation_post === 1 && value.result_get === 2 && value.unexpected === 0;
}

function statusForError(error, prior) {
  if (prior === "HELD_UNKNOWN") return prior;
  if (error?.message === "RETAINED_ATTEMPT_MISMATCH") return "RETAINED_ATTEMPT_MISMATCH";
  return "OUTCOME_UNKNOWN";
}

function delay(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
function isDirectInvocation() { return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; }

if (isDirectInvocation()) {
  const config = parseOwnerDurableRestartSmokeArgs(process.argv.slice(2));
  if (config === null) {
    process.stderr.write(`Refusing owner durable restart smoke. Select exactly ${CONFIRM_FLAG} ${FAKE_ONLY_FLAG}|${REAL_MODE_FLAG} ${HANDOFF_FLAG}.\n`);
    process.exitCode = 2;
  } else {
    const sendPrivateIpc = typeof process.send === "function" ? (message) => new Promise((resolvePromise, reject) => process.send(message, (error) => error ? reject(error) : resolvePromise(true))) : undefined;
    const result = await runOwnerDurableRestartSmoke(config, process, { ...(sendPrivateIpc === undefined ? {} : { sendPrivateIpc }) }).catch(() => summary("FAILED"));
    process.stdout.write(JSON.stringify(result) + "\n");
    if (result.status !== "PASS") process.exitCode = 1;
  }
}
