import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import test from "node:test";
import { PassThrough } from "node:stream";
import * as smokeModule from "../scripts/live-owner-auth-restart-smoke.mjs";

const confirmation = "--confirm-owner-auth-restart-smoke";
const fakeOnly = "--fake-only";
const realMode = "--real";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function importTestBuild(relativePath) {
  const buildRoot = process.env.SYNTX_OWNER_TEST_BUILD_ROOT ?? join(projectRoot, "dist");
  return import(pathToFileURL(join(buildRoot, relativePath)).href);
}

function fakeLifecycle(options = {}) {
  const events = [];
  const attemptId = "link_fake_attempt_000000000000001";
  const state = { status: "HANDOFF_ISSUED", fakeTokenCompleted: false, begin: 0, authPolls: 0, accountReads: 0, unlinkCalls: 0, unlinkRequests: 0, cleanupCalls: 0, checkCount: 0 };
  const fixture = { profileDirectory: "private-fixture", keyFile: "private-key" };
  const stdin = new PassThrough();
  const io = {
    stdin,
    stdout: {
      write(line) {
        const message = JSON.parse(line);
        events.push(`stdout:${message.event ?? message.status}`);
        if (message.event === "BEGIN") setImmediate(() => stdin.write('{"action":"handoff_sent"}\n'));
      }
    }
  };
  const dependencies = {
    createPrivateFixture() { events.push("profile_create"); return fixture; },
    async createOwnerClient(_fixture, childIndex) {
      events.push(`child${childIndex}_spawn`);
      return {
        client: {
          async callTool(request) {
            events.push(`child${childIndex}:${request.name}`);
            if (request.name === "syntx_begin_login") {
              state.begin += 1;
              return { structuredContent: { attempt_id: attemptId, status: "HANDOFF_ISSUED", linked: false }, content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000000" }] };
            }
            if (request.name === "syntx_check_login") {
              assert.equal(request.arguments.attempt_id, attemptId);
              state.checkCount += 1;
              if (childIndex === 1 && options.firstCheckLinked === false) return { structuredContent: { attempt_id: attemptId, status: "POLLING", linked: false } };
              if (childIndex === 2 && options.wrongRetainedAttempt === true) return { structuredContent: { attempt_id: "link_fake_attempt_wrong0000000000", status: "LINKED", linked: true } };
              if (!state.fakeTokenCompleted) { state.authPolls += 1; state.fakeTokenCompleted = true; state.status = "LINKED"; }
              return { structuredContent: { attempt_id: attemptId, status: state.status, linked: state.status === "LINKED" } };
            }
            if (request.name === "syntx_get_account_status") {
              assert.equal(request.arguments.link_attempt_id, attemptId);
              state.accountReads += 1;
              return { structuredContent: { subscription: { active: true } } };
            }
            if (request.name === "syntx_unlink") {
              assert.equal(request.arguments.attempt_id, attemptId);
              state.unlinkRequests += 1;
              if (options.unlinkUnknown === true) return { isError: true, content: [{ type: "text", text: "redacted" }] };
              state.unlinkCalls += 1; state.status = "REVOKED";
              return { structuredContent: { attempt_id: attemptId, status: "REVOKED", linked: false } };
            }
            throw new Error("unexpected fake MCP request");
          },
          async close() { events.push(`child${childIndex}_eof`); }
        },
        async waitForExit() { events.push(`child${childIndex}_exit`); return options.exitFailureChild !== childIndex; }
      };
    },
    async waitForProfileLeaseAbsent() { events.push("lease_absent"); return true; },
    readFakeUpstreamAudit() { return { auth_start_count: state.begin, auth_token_poll_count: state.authPolls, balance_read_count: state.accountReads, subscription_read_count: state.accountReads, unexpected_request_count: 0 }; },
    cleanupPrivateFixture() { events.push("fixture_cleanup"); state.cleanupCalls += 1; return options.cleanupUnknown !== true; }
  };
  return { io, dependencies, events, state, attemptId };
}

test("CLI requires an explicit fake-only or real mode and rejects ambiguous arguments", async () => {
  const module = await smokeModule;
  assert.ok(module, "owner-auth restart harness module must exist");
  assert.equal(module.parseOwnerAuthRestartSmokeArgs([]), null);
  assert.equal(module.parseOwnerAuthRestartSmokeArgs([confirmation]), null);
  assert.equal(module.parseOwnerAuthRestartSmokeArgs([confirmation, "--handoff-json"]), null);
  assert.equal(module.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, realMode, "--handoff-json"]), null);
  const config = module.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  assert.equal(config.mode, "FAKE_OWNER_AUTH_RESTART");
  const realConfig = module.parseOwnerAuthRestartSmokeArgs([confirmation, realMode, "--handoff-json"]);
  assert.ok(realConfig);
  assert.equal(realConfig.mode, "REAL_OWNER_AUTH_RESTART");
  let fixtureCalls = 0;
  let childCalls = 0;
  await assert.rejects(module.runOwnerAuthRestartSmoke(null, {
    stdin: process.stdin,
    stdout: { write() {} }
  }, {
    createPrivateFixture() { fixtureCalls += 1; throw new Error("must not create a fixture"); },
    createChild() { childCalls += 1; throw new Error("must not start a child"); }
  }));
  assert.equal(fixtureCalls, 0);
  assert.equal(childCalls, 0);
});

test("REAL mode refuses without private parent IPC before fixture creation", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, realMode, "--handoff-json"]);
  assert.ok(config);
  let fixtureCalls = 0;
  await assert.rejects(smokeModule.runOwnerAuthRestartSmoke(config, {
    stdin: new PassThrough(), stdout: { write() {} }
  }, {
    createPrivateFixture() { fixtureCalls += 1; throw new Error("must not create a fixture"); },
    createOwnerClient() { throw new Error("must not start a child"); }
  }), /PRIVATE_IPC_REQUIRED/u);
  assert.equal(fixtureCalls, 0);
});

test("REAL and fake child environments are disjoint: only fake mode injects the fetch shim", async () => {
  const envBuilder = smokeModule.buildOwnerAuthRestartChildEnv;
  assert.equal(typeof envBuilder, "function");
  const fixture = { profileDirectory: "private-profile", keyFilePath: "private-key", auditFilePath: "private-audit", bootstrapFilePath: "private-bootstrap" };
  const realEnv = envBuilder("REAL_OWNER_AUTH_RESTART", fixture);
  const fakeEnv = envBuilder("FAKE_OWNER_AUTH_RESTART", fixture);
  assert.deepEqual(realEnv, {
    SYNTX_OWNER_AUTH_PROFILE_DIRECTORY: "private-profile",
    SYNTX_OWNER_AUTH_KEY_FILE: "private-key",
    SYNTX_OWNER_ACCOUNT_STATUS: "1"
  });
  assert.equal(Object.hasOwn(realEnv, "NODE_OPTIONS"), false);
  assert.equal(Object.hasOwn(realEnv, "SYNTX_OWNER_AUTH_RESTART_FAKE_AUDIT_FILE"), false);
  assert.equal(fakeEnv.NODE_OPTIONS.startsWith("--import=file://"), true);
  assert.equal(fakeEnv.NODE_OPTIONS.endsWith("/private-bootstrap"), true);
  assert.equal(fakeEnv.SYNTX_OWNER_AUTH_RESTART_FAKE_AUDIT_FILE, "private-audit");
});

test("REAL BEGIN is delivered only over parent IPC and never written to stdout", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, realMode, "--handoff-json"]);
  assert.ok(config);
  const attemptId = "link_real_mode_mock_attempt_000000000001";
  const uri = "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000000";
  const io = new EventEmitter();
  io.stdin = new PassThrough();
  const stdout = [];
  io.stdout = { write(line) { stdout.push(line); } };
  const ipc = [];
  let childIndex = 0;
  let childOneCheckCount = 0;
  const fixture = { mode: "REAL_OWNER_AUTH_RESTART", profileDirectory: "private-profile", keyFilePath: "private-key" };
  const dependencies = {
    createPrivateFixture() { return fixture; },
    sendPrivateIpc(message) { ipc.push(message); setImmediate(() => io.emit("message", { action: "handoff_sent" })); return true; },
    waitForLoginPollInterval() { return true; },
    async createOwnerClient(_fixture, index) {
      childIndex = index;
      let status = "LINKED";
      return {
        client: { async callTool({ name, arguments: args }) {
          if (name === "syntx_begin_login") return { structuredContent: { attempt_id: attemptId }, content: [{ type: "resource_link", uri }] };
          if (name === "syntx_check_login") {
            assert.equal(args.attempt_id, attemptId);
            if (index === 1 && childOneCheckCount++ === 0) return { structuredContent: { attempt_id: attemptId, status: "POLLING", linked: false } };
            return { structuredContent: { attempt_id: attemptId, status, linked: status === "LINKED" } };
          }
          if (name === "syntx_get_account_status") return { structuredContent: { subscription: { active: false } } };
          if (name === "syntx_unlink") { status = "REVOKED"; return { structuredContent: { attempt_id: attemptId, status: "REVOKED", linked: false } }; }
          throw new Error("unexpected mock MCP request");
        }, async close() {} },
        async waitForExit() { return true; }
      };
    },
    async waitForProfileLeaseAbsent() { return true; },
    cleanupPrivateFixture() { return true; }
  };

  const result = await smokeModule.runOwnerAuthRestartSmoke(config, io, dependencies);
  assert.deepEqual(ipc[0], { event: "FIXTURE_CREATED", profile_directory: "private-profile" });
  assert.deepEqual(ipc[1], { event: "BEGIN", attempt_id: attemptId, handoff_uri: uri });
  assert.deepEqual(ipc[2], { event: "FINAL", ...result });
  assert.equal(JSON.stringify(ipc[2]).includes(attemptId), false);
  assert.equal(JSON.stringify(ipc[2]).includes(uri), false);
  assert.deepEqual(stdout, []);
  assert.equal(result.status, "PASS");
  assert.equal(result.fake_upstream_boundary_pass, false);
  assert.equal(result.fixture_cleanup_status, "CLEANED");
  assert.equal(childIndex, 2);
  assert.equal(childOneCheckCount, 2);
});

test("REAL login polling stops at the absolute deadline without another check or restart", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, realMode, "--handoff-json"]);
  assert.ok(config);
  const io = new EventEmitter();
  io.stdin = new PassThrough();
  io.stdout = { write() {} };
  let clock = 1_000;
  let beginCount = 0;
  let loginCheckCount = 0;
  let childCount = 0;
  const fixture = { mode: "REAL_OWNER_AUTH_RESTART", profileDirectory: "private-profile", keyFilePath: "private-key" };
  const dependencies = {
    now() { return clock; },
    createPrivateFixture() { return fixture; },
    sendPrivateIpc(message) { if (message.event === "BEGIN") setImmediate(() => io.emit("message", { action: "handoff_sent" })); return true; },
    waitForLoginPollInterval() { clock = 181_000; return true; },
    async createOwnerClient() {
      childCount += 1;
      return {
        client: { async callTool({ name }) {
          if (name === "syntx_begin_login") { beginCount += 1; return { structuredContent: { attempt_id: "link_pending_attempt_000000000000" }, content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000000" }] }; }
          if (name === "syntx_check_login") { loginCheckCount += 1; return { structuredContent: { attempt_id: "link_pending_attempt_000000000000", status: "POLLING", linked: false } }; }
          throw new Error("unexpected mock MCP request");
        }, async close() {} },
        async waitForExit() { return true; }
      };
    },
    async cleanupPrivateFixture() { return true; }
  };

  const result = await smokeModule.runOwnerAuthRestartSmoke(config, io, dependencies);
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  assert.equal(beginCount, 1);
  assert.equal(loginCheckCount, 1);
  assert.equal(childCount, 1);
  assert.equal(result.fixture_cleanup_status, "RETAINED");
});

test("actual MCP auth runtime maps an incomplete fake token reply to POLLING then LINKED on the same attempt", async () => {
  const [{ createObservedOwnerRuntime }, { createMcpServer }] = await Promise.all([
    importTestBuild("src/runtime/observed-owner-runtime.js"),
    importTestBuild("src/mcp/server.js")
  ]);
  const token = "synthetic-owner-credential-for-test-only";
  const tokenUuid = "00000000-0000-4000-8000-000000000043";
  const requestCounts = { begin: 0, token: 0, balance: 0, subscription: 0 };
  const statuses = [];
  const attemptIds = [];
  const stdout = [];
  const io = new EventEmitter();
  io.stdin = new PassThrough();
  io.stdout = { write(line) { stdout.push(line); } };
  const runtime = createObservedOwnerRuntime({
    accountStatusEnabled: true,
    catalogDirectory: join(projectRoot, "catalog"),
    publicCatalogVersion: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    requestTimeoutMs: 2_000,
    fetchImpl: async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      if (url.origin !== "https://api.syntx.ai") throw new Error("unexpected synthetic upstream origin");
      if (url.pathname === "/api/v1/auth/startauth" && method === "POST") { requestCounts.begin += 1; return json({ uuid: tokenUuid }); }
      if (url.pathname === `/api/v1/auth/token/${tokenUuid}` && method === "GET") {
        requestCounts.token += 1;
        return requestCounts.token === 1
          ? json({ valid: true, complete: false })
          : json({ valid: true, complete: true, token, is_new_user: false });
      }
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      if (headers.get("authorization") !== `Bearer ${token}`) throw new Error("unexpected synthetic credential scope");
      if (url.pathname === "/api/v1/user/balance" && method === "GET") { requestCounts.balance += 1; return json({ balance: null }); }
      if (url.pathname === "/api/v1/user/subscription" && method === "GET" && url.search === "?ref=false") { requestCounts.subscription += 1; return json({ active: false }); }
      throw new Error("unexpected synthetic upstream route");
    }
  });
  const dependencies = {
    createPrivateFixture() { return { mode: "REAL_OWNER_AUTH_RESTART", profileDirectory: "runtime-fixture", keyFilePath: "runtime-key" }; },
    sendPrivateIpc(message) { if (message.event === "BEGIN") setImmediate(() => io.emit("message", { action: "handoff_sent" })); return true; },
    waitForLoginPollInterval() { return true; },
    async createOwnerClient(_fixture, childIndex) {
      const server = createMcpServer(runtime.application, runtime.serverOptions);
      const client = new Client({ name: `owner-auth-runtime-test-${childIndex}`, version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const recordingClient = {
        async callTool(request) {
          if (request.name === "syntx_check_login") attemptIds.push(request.arguments.attempt_id);
          const result = await client.callTool(request);
          if (request.name === "syntx_check_login") statuses.push(result.structuredContent?.status);
          return result;
        },
        close: () => client.close()
      };
      return { client: recordingClient, async waitForExit() { await server.close(); return true; } };
    },
    async waitForProfileLeaseAbsent() { return true; },
    cleanupPrivateFixture() { return true; }
  };
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, realMode, "--handoff-json"]);
  const result = await smokeModule.runOwnerAuthRestartSmoke(config, io, dependencies);

  assert.equal(result.status, "PASS");
  assert.deepEqual(statuses, ["POLLING", "LINKED", "LINKED", "REVOKED"]);
  assert.equal(attemptIds.length, 4);
  assert.ok(attemptIds.every((id) => id === attemptIds[0]));
  assert.deepEqual(requestCounts, { begin: 1, token: 2, balance: 1, subscription: 1 });
  assert.deepEqual(stdout, []);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("one fake BEGIN survives two SDK child lifetimes and exact-attempt unlink is read back before cleanup", async () => {
  const module = await smokeModule;
  assert.ok(module);
  const config = module.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  const harness = fakeLifecycle();
  const result = await module.runOwnerAuthRestartSmoke(config, harness.io, harness.dependencies);

  assert.equal(harness.state.begin, 1);
  assert.equal(harness.state.authPolls, 1);
  assert.equal(harness.state.accountReads, 1);
  assert.equal(harness.state.unlinkCalls, 1);
  assert.deepEqual(harness.events.slice(0, 5), ["profile_create", "child1_spawn", "child1:syntx_begin_login", "stdout:BEGIN", "child1:syntx_check_login"]);
  assert.ok(harness.events.indexOf("child1_exit") < harness.events.indexOf("child2_spawn"));
  assert.ok(harness.events.indexOf("child2:syntx_unlink") < harness.events.lastIndexOf("child2:syntx_check_login"));
  assert.equal(result.status, "PASS");
  assert.equal(result.same_attempt_retained, true);
  assert.equal(result.one_begin_acknowledged, true);
  assert.equal(result.first_child_exit_observed, true);
  assert.equal(result.second_child_exit_observed, true);
  assert.equal(result.unlink_revoked_readback, true);
  assert.equal(result.fixture_cleanup_status, "CLEANED");
  const summary = JSON.stringify(result);
  for (const forbidden of [harness.attemptId, "private-fixture", "private-key", "00000000-0000", "OwnerTest", "balance", "token"]) assert.equal(summary.includes(forbidden), false);
});

test("a missing LINKED state closes child one, starts no second login and retains the fixture", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  const harness = fakeLifecycle({ firstCheckLinked: false });
  const result = await smokeModule.runOwnerAuthRestartSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "AUTH_NOT_LINKED");
  assert.equal(harness.state.begin, 1);
  assert.equal(harness.events.includes("child2_spawn"), false);
  assert.equal(harness.state.unlinkCalls, 0);
  assert.equal(result.fixture_cleanup_status, "RETAINED");
  assert.equal(result.fixture_retained, true);
});

test("a failed first child exit prevents restart and preserves the private fixture", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  const harness = fakeLifecycle({ exitFailureChild: 1 });
  const result = await smokeModule.runOwnerAuthRestartSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "CHILD_EXIT_UNKNOWN");
  assert.equal(result.first_child_exit_observed, false);
  assert.equal(harness.events.includes("child2_spawn"), false);
  assert.equal(harness.state.begin, 1);
  assert.equal(harness.state.unlinkCalls, 0);
  assert.equal(result.fixture_cleanup_status, "RETAINED");
});

test("a different retained attempt fails closed without account read, unlink retry or cleanup", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  const harness = fakeLifecycle({ wrongRetainedAttempt: true });
  const result = await smokeModule.runOwnerAuthRestartSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "RETAINED_ATTEMPT_MISMATCH");
  assert.equal(harness.state.begin, 1);
  assert.equal(harness.state.accountReads, 0);
  assert.equal(harness.state.unlinkCalls, 0);
  assert.equal(result.fixture_cleanup_status, "RETAINED");
});

test("an unknown unlink response is not retried and preserves the profile fixture", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  const harness = fakeLifecycle({ unlinkUnknown: true });
  const result = await smokeModule.runOwnerAuthRestartSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  assert.equal(harness.state.unlinkRequests, 1);
  assert.equal(harness.state.checkCount, 2);
  assert.equal(harness.state.cleanupCalls, 0);
  assert.equal(result.fixture_retained, true);
});

test("unknown fixture cleanup is reported and never retried", async () => {
  const config = smokeModule.parseOwnerAuthRestartSmokeArgs([confirmation, fakeOnly, "--handoff-json"]);
  assert.ok(config);
  const harness = fakeLifecycle({ cleanupUnknown: true });
  const result = await smokeModule.runOwnerAuthRestartSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "FIXTURE_CLEANUP_UNKNOWN");
  assert.equal(harness.state.unlinkRequests, 1);
  assert.equal(harness.state.cleanupCalls, 1);
  assert.equal(result.fixture_cleanup_status, "UNKNOWN");
  assert.equal(result.fixture_retained, true);
});
