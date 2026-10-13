import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as smoke from "../scripts/live-owner-durable-restart-smoke.mjs";

const confirm = "--confirm-owner-durable-restart-smoke";

test("CLI requires one explicit fake-only or real mode", () => {
  assert.equal(smoke.parseOwnerDurableRestartSmokeArgs([]), null);
  assert.equal(smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--handoff-json"]), null);
  assert.equal(smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--fake-only", "--real", "--handoff-json"]), null);
  const fake = smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--fake-only", "--handoff-json"]);
  const real = smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--real", "--handoff-json"]);
  assert.equal(fake.mode, "FAKE_OWNER_DURABLE_RESTART");
  assert.equal(real.mode, "REAL_OWNER_DURABLE_RESTART");
  assert.ok(Object.isFrozen(fake));
});

test("REAL mode requires private parent IPC before creating a profile or launching stdio", async () => {
  const config = smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--real", "--handoff-json"]);
  let fixtures = 0;
  const result = await smoke.runOwnerDurableRestartSmoke(config, process, {
    createPrivateFixture() { fixtures += 1; throw new Error("fixture must not be created"); }
  });
  assert.equal(result.status, "REAL_MODE_PRIVATE_IPC_REQUIRED");
  assert.equal(fixtures, 0);
});

test("a failed SDK client connection closes the spawned stdio transport", async () => {
  let closes = 0;
  class BrokenClient { async connect() { throw new Error("private startup detail"); } }
  class SpawnedTransport { constructor() { this.stderr = null; } async close() { closes += 1; } }
  await assert.rejects(smoke.createDefaultOwnerClient({ profileDirectory: "/private/profile", keyFilePath: "/private/key" }, "REAL_OWNER_DURABLE_RESTART", {
    Client: BrokenClient, StdioClientTransport: SpawnedTransport
  }), /OWNER_STDIO_STARTUP_FAILED/u);
  assert.equal(closes, 1);
});

test("REAL orchestration accepts only the fixed owner intent and retains its private profile", async () => {
  const { result, messages, starts } = await runRealScenario({ jobs: [{ id: "generation_mock_64", status: "succeeded" }] });
  const attemptId = "link_owner_durable_real_attempt_000000000064";
  const uri = "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000064";
  const intent = messages.find((message) => message.event === "OWNER_INTENT");
  assert.equal(intent.model_id, "banana-2.1");
  assert.equal(intent.operation_id, "generate-image");
  assert.equal(intent.variant_id, "banana21-image-2k-medium-landscape");
  assert.equal(intent.cost_disclosure.startsWith("OWNER_UNCAPPED;"), true);
  assert.equal(result.status, "PASS");
  assert.equal(result.fixture_retained, true);
  assert.equal(result.fixture_cleanup_status, "RETAINED");
  assert.equal(starts, 1);
  assert.equal(messages.filter((message) => message.event === "FINAL").length, 1);
  const recoveryReference = messages.find((message) => message.event === "RECOVERY_REFERENCE");
  assert.equal(recoveryReference.attempt_id, attemptId);
  assert.equal(recoveryReference.job_id, "generation_mock_64");
  assert.equal(typeof recoveryReference.idempotency_key, "string");
  assert.equal(JSON.stringify(messages.at(-1)).includes(attemptId), false);
  assert.equal(JSON.stringify(messages.at(-1)).includes(uri), false);
  assert.equal(Object.hasOwn(messages.at(-1), "job_id"), false);
});

test("REAL recovery waits through pending states until delayed success", async () => {
  let now = 0;
  const run = await runRealScenario({
    jobs: [{ id: "generation_mock_64", status: "queued" }, { id: "generation_mock_64", status: "running" }, { id: "generation_mock_64", status: "succeeded" }],
    now: () => now, recoveryDeadlineMs: 7_500,
    waitForRecoveryPollInterval: async (ms) => { now += ms; return true; }
  });
  assert.equal(run.result.status, "PASS");
  assert.equal(run.gets, 3);
  assert.equal(run.starts, 1);
});

test("REAL recovery timeout returns the last known pending state without retrying", async () => {
  let now = 0;
  const run = await runRealScenario({
    jobs: [{ id: "generation_mock_64", status: "running" }],
    now: () => now, recoveryDeadlineMs: 5_000,
    waitForRecoveryPollInterval: async (ms) => { now += ms; return true; }
  });
  assert.equal(run.result.status, "RECOVERY_PENDING");
  assert.equal(run.result.no_retry, true);
  assert.equal(run.result.last_known_job_status, "running");
  assert.equal(run.gets, 2);
  assert.equal(run.starts, 1);
  assert.equal(run.result.fixture_retained, true);
});

test("REAL unknown start remains held through GET-only recovery", async () => {
  let now = 0;
  const run = await runRealScenario({
    startResult: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "UPSTREAM_OUTCOME_UNKNOWN", job_id: "generation_mock_64" } }) }] },
    jobs: [{ id: "generation_mock_64", status: "running" }],
    now: () => now, recoveryDeadlineMs: 1_000,
    waitForRecoveryPollInterval: async (ms) => { now += ms; return true; }
  });
  assert.equal(run.result.status, "HELD_UNKNOWN");
  assert.equal(run.result.no_retry, true);
  assert.equal(run.starts, 1);
  assert.equal(run.gets, 1);
  assert.equal(run.result.last_known_job_status, "running");
  assert.equal(run.messages.some((message) => message.event === "RECOVERY_REFERENCE" && message.job_id === "generation_mock_64"), true);
});

test("fake mode uses stock stdio children to recover the one synthetic generation after restart", { timeout: 65_000 }, () => {
  const script = fileURLToPath(new URL("../scripts/live-owner-durable-restart-smoke.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [script, confirm, "--fake-only", "--handoff-json"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 60_000, maxBuffer: 16_384
  });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, "PASS");
  assert.equal(result.first_process_close_observed, true);
  assert.equal(result.first_lease_absent, true);
  assert.equal(result.second_process_close_observed, true);
  assert.equal(result.second_lease_absent, true);
  assert.equal(result.fake_provider_boundary_pass, true);
  assert.deepEqual(result.result, { status: "succeeded", artifact_count: 1, mime_types: ["image/jpeg"] });
  for (const forbidden of ["auth.key", "synthetic-owner-durable-token", "synthetic-message-62", "synthetic-chat-62", "prompt", "download_url"]) {
    assert.equal(run.stdout.includes(forbidden), false);
  }
});

test("a wrong linked attempt is rejected before the durable job GET", async () => {
  const config = smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--fake-only", "--handoff-json"]);
  const attemptId = "link_owner_durable_attempt_000000000062";
  let childIndex = 0;
  let durableGets = 0;
  let fixtureCleanup = 0;
  const tools = ["syntx_check_login", "syntx_owner_get_durable_job", "syntx_owner_get_durable_result", "syntx_begin_login", "syntx_owner_start_durable_generation"];
  const result = await smoke.runOwnerDurableRestartSmoke(config, process, {
    createPrivateFixture() { return { profileDirectory: "/private/profile", keyFilePath: "/private/auth.key" }; },
    async createOwnerClient() {
      childIndex += 1;
      return {
        client: {
          async listTools() { return { tools: tools.map((name) => ({ name })) }; },
          async callTool({ name }) {
            if (name === "syntx_begin_login") return { structuredContent: { attempt_id: attemptId } };
            if (name === "syntx_check_login") return { structuredContent: childIndex === 1
              ? { attempt_id: attemptId, status: "LINKED", linked: true }
              : { attempt_id: "link_owner_durable_wrong_attempt_000000", status: "LINKED", linked: true } };
            if (name === "syntx_owner_start_durable_generation") return { structuredContent: { job_id: "generation_fake_62", status: "queued" } };
            if (name === "syntx_owner_get_durable_job") { durableGets += 1; return { structuredContent: { id: "generation_fake_62", status: "succeeded" } }; }
            throw new Error("unexpected test tool");
          },
          async close() {}
        }, async waitForExit() { return true; }
      };
    },
    async waitForProfileLeaseAbsent() { return true; },
    cleanupPrivateFixture() { fixtureCleanup += 1; return true; }
  });
  assert.equal(result.status, "RETAINED_ATTEMPT_MISMATCH");
  assert.equal(durableGets, 0);
  assert.equal(fixtureCleanup, 0);
  assert.equal(result.fixture_retained, true);
});

test("an unknown generation receipt is held and never starts another generation", async () => {
  const config = smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--fake-only", "--handoff-json"]);
  const attemptId = "link_owner_durable_attempt_000000000063";
  let childIndex = 0;
  let starts = 0;
  let gets = 0;
  let cleanup = 0;
  const toolNames = ["syntx_check_login", "syntx_owner_get_durable_job", "syntx_owner_get_durable_result", "syntx_begin_login", "syntx_owner_start_durable_generation"];
  const result = await smoke.runOwnerDurableRestartSmoke(config, process, {
    createPrivateFixture() { return { profileDirectory: "/private/profile", keyFilePath: "/private/auth.key" }; },
    async createOwnerClient() {
      childIndex += 1;
      return {
        client: {
          async listTools() { return { tools: toolNames.map((name) => ({ name })) }; },
          async callTool({ name }) {
            if (name === "syntx_begin_login") return { structuredContent: { attempt_id: attemptId } };
            if (name === "syntx_check_login") return { structuredContent: { attempt_id: attemptId, status: "LINKED", linked: true } };
            if (name === "syntx_owner_start_durable_generation") {
              starts += 1;
              return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "UPSTREAM_OUTCOME_UNKNOWN", job_id: "generation_unknown_63" } }) }] };
            }
            if (name === "syntx_owner_get_durable_job") { gets += 1; return { structuredContent: { id: "generation_unknown_63", status: "running" } }; }
            throw new Error("unexpected test tool");
          }, async close() {}
        }, async waitForExit() { return true; }
      };
    },
    async waitForProfileLeaseAbsent() { return true; },
    cleanupPrivateFixture() { cleanup += 1; return true; }
  });
  assert.equal(result.status, "HELD_UNKNOWN");
  assert.equal(result.no_retry, true);
  assert.equal(result.fixture_retained, true);
  assert.equal(starts, 1);
  assert.equal(gets, 6);
  assert.equal(cleanup, 0);
});

async function runRealScenario(options) {
  const config = smoke.parseOwnerDurableRestartSmokeArgs([confirm, "--real", "--handoff-json"]);
  const io = new EventEmitter();
  const attemptId = "link_owner_durable_real_attempt_000000000064";
  const uri = "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000064";
  const messages = [];
  const toolNames = ["syntx_check_login", "syntx_owner_get_durable_job", "syntx_owner_get_durable_result", "syntx_begin_login", "syntx_owner_start_durable_generation"];
  let childIndex = 0;
  let starts = 0;
  let gets = 0;
  const result = await smoke.runOwnerDurableRestartSmoke(config, io, {
    now: options.now,
    recoveryDeadlineMs: options.recoveryDeadlineMs,
    waitForRecoveryPollInterval: options.waitForRecoveryPollInterval,
    createPrivateFixture() { return { profileDirectory: "/private/fresh-profile", keyFilePath: "/private/fresh-key" }; },
    sendPrivateIpc(message) {
      messages.push(message);
      if (message.event === "BEGIN") setImmediate(() => io.emit("message", { action: "handoff_sent", attempt_id: message.attempt_id }));
      if (message.event === "OWNER_INTENT") setImmediate(() => io.emit("message", { action: "generation_approved", idempotency_key: message.idempotency_key }));
      return true;
    },
    async createOwnerClient() {
      childIndex += 1;
      return {
        client: {
          async listTools() { return { tools: toolNames.map((name) => ({ name })) }; },
          async callTool({ name, arguments: args }) {
            if (name === "syntx_begin_login") return { structuredContent: { attempt_id: attemptId }, content: [{ type: "resource_link", uri }] };
            if (name === "syntx_check_login") return { structuredContent: { attempt_id: args.attempt_id, status: "LINKED", linked: true } };
            if (name === "syntx_owner_start_durable_generation") { starts += 1; return options.startResult ?? { structuredContent: { job_id: "generation_mock_64", status: "queued" } }; }
            if (name === "syntx_owner_get_durable_job") { gets += 1; const i = Math.min(gets - 1, options.jobs.length - 1); return { structuredContent: options.jobs[i] }; }
            if (name === "syntx_owner_get_durable_result") return { structuredContent: { job_id: args.job_id, artifacts: [{ mime_type: "image/jpeg" }] } };
            throw new Error("unexpected test tool");
          }, async close() {}
        }, async waitForExit() { return true; }
      };
    }
  });
  return { result, messages, starts, gets, childIndex };
}
