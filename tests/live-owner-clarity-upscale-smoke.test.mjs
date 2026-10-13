import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import test from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const scriptPath = resolve("scripts/live-owner-clarity-upscale-smoke.mjs");
const CASE_ID = "clarity-amber-checker-upscale-v2";
const HISTORICAL_CASE_ID = "clarity-cobalt-grid-upscale-v1";
const FRESH_CASE_ID = "clarity-emerald-bars-upscale-v3";
const SAFE_UNKNOWN_DIAGNOSTIC = Object.freeze({
  phase: "HISTORY_GET", echo_ack_known: true, history_get_eligible: true,
  history_get_performed: true, history_get_count: 1, history_get_count_capped: false,
  history_binding: "NOT_RUN", history_binding_reason: null, result_get_performed: false, result_get_count: 0,
  result_get_count_capped: false, unverified_reason: null, upstream_error_code: "UPSTREAM_UNAVAILABLE"
});
let modulePromise;

async function load() {
  assert.equal(existsSync(scriptPath), true, "the Clarity owner operator harness must exist");
  return modulePromise ??= import(pathToFileURL(scriptPath).href);
}

test("CLI retains non-mutating modes and rejects all ended Clarity real-case grammars", async () => {
  const module = await load();
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs(["--help"]).mode, "HELP");
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs(["--describe"]).mode, "DESCRIBE");
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs(["--dry-run"]).mode, "DRY_RUN");
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs(["--read-only"]).mode, "READ_ONLY");
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs([
    "--confirm-owner-clarity-upscale-smoke", "--real", "--case", CASE_ID
  ]), null);
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs([
    "--confirm-owner-clarity-upscale-smoke", "--real", "--case", HISTORICAL_CASE_ID
  ]), null);
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs([
    "--confirm-owner-clarity-upscale-smoke", "--real", "--case", FRESH_CASE_ID
  ]), null);
  for (const invalid of [
    [], ["--real", "--case", CASE_ID], ["--confirm-owner-clarity-upscale-smoke", "--mock", "--case", CASE_ID],
    ["--confirm-owner-clarity-upscale-smoke", "--real", "--case", "other"],
    ["--confirm-owner-clarity-upscale-smoke", "--real", "--case", CASE_ID, "--prompt", "caller input"],
    ["--confirm-owner-clarity-upscale-smoke", "--real", "--case", CASE_ID, "--image", "/tmp/input.png"],
    ["--confirm-owner-clarity-upscale-smoke", "--real", "--case", FRESH_CASE_ID, "--prompt", "caller input"]
  ]) assert.equal(module.parseOwnerClarityUpscaleSmokeArgs(invalid), null);
});

test("spent Emerald real grammar rejects while its synthetic fixture stays pixel-distinct", async () => {
  const module = await load();
  assert.equal(module.parseOwnerClarityUpscaleSmokeArgs([
    "--confirm-owner-clarity-upscale-smoke", "--real", "--case", FRESH_CASE_ID
  ]), null);
  assert.equal(module.OWNER_CLARITY_UPSCALE_CASE_ID, FRESH_CASE_ID);
  const first = module.createOwnerClarityUpscaleEmeraldFixture();
  const second = module.createOwnerClarityUpscaleEmeraldFixture();
  const amber = module.createOwnerClarityUpscaleAmberFixture();
  const cobalt = module.createOwnerClarityUpscaleFixture();
  assert.deepEqual([first.filename, first.mime_type, first.width, first.height], [
    "clarity-emerald-bars-upscale-v3.png", "image/png", 512, 512
  ]);
  assert.deepEqual(module.OWNER_CLARITY_UPSCALE_CASE.parameters, {
    professional_mode: false, scale_factor: 2, strength: 0.35, cfg: 6, denoise: 0.25
  });
  assert.equal(module.OWNER_CLARITY_UPSCALE_CASE.prompt, null);
  assert.match(first.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.pixel_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.sha256, `sha256:${createHash("sha256").update(first.bytes).digest("hex")}`);
  assert.deepEqual([first.sha256, first.pixel_sha256, first.bytes.length], [second.sha256, second.pixel_sha256, second.bytes.length]);
  assert.notEqual(first.sha256, amber.sha256);
  assert.notEqual(first.pixel_sha256, amber.pixel_sha256);
  assert.notEqual(first.sha256, cobalt.sha256);
  assert.notEqual(first.pixel_sha256, cobalt.pixel_sha256);
});

test("spent real argv exits before owner bootstrap and internal fixture mode requires injected fakes", async () => {
  const module = await load();
  for (const caseId of [CASE_ID, HISTORICAL_CASE_ID, FRESH_CASE_ID]) {
    const child = spawnSync(process.execPath, [scriptPath, "--confirm-owner-clarity-upscale-smoke", "--real", "--case", caseId], {
      encoding: "utf8", timeout: 2_000
    });
    assert.equal(child.status, 2);
    assert.equal(child.stdout, "");
    assert.match(child.stderr, /Refusing Clarity owner operation/u);
  }
  let childStarts = 0;
  const internalConfig = module.createOwnerClarityUpscaleInternalFixtureConfig();
  const denied = await module.runOwnerClarityUpscaleSmoke(internalConfig, process, {
    createOwnerClient: async () => { childStarts += 1; throw new Error("must not start a child"); }
  });
  assert.equal(denied.status, "TEST_FIXTURE_DEPENDENCIES_REQUIRED");
  assert.equal(childStarts, 0);
});

test("historical Cobalt fixture remains reproducible and is not the current paid case", async () => {
  const module = await load();
  const first = module.createOwnerClarityUpscaleFixture();
  const second = module.createOwnerClarityUpscaleFixture();
  assert.equal(Buffer.isBuffer(first.bytes), true);
  assert.deepEqual([first.filename, first.mime_type, first.width, first.height], [
    "clarity-cobalt-grid-upscale-v1.png", "image/png", 512, 512
  ]);
  assert.equal(first.sha256, "sha256:67436f1be2078f0395df95406fb3df563936411c9c8f2571c666ae5fc9414263");
  assert.equal(first.pixel_sha256, "sha256:1ceab4bf8f3b8a7f44b6deafa09832515892240af2e4a25ba0abc00773ecd79a");
  assert.deepEqual(first.bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(first.bytes.length < 7 * 1024 * 1024, true);
  assert.equal(first.sha256, `sha256:${createHash("sha256").update(first.bytes).digest("hex")}`);
  assert.match(first.pixel_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual({ sha256: first.sha256, pixel_sha256: first.pixel_sha256, bytes: first.bytes.length },
    { sha256: second.sha256, pixel_sha256: second.pixel_sha256, bytes: second.bytes.length });
  assert.equal(first.runtime_node_version, process.versions.node);
});

test("ended Amber fixture retains its literal hashes while active Emerald binds the new settings", async () => {
  const module = await load();
  const amber = module.createOwnerClarityUpscaleAmberFixture();
  const cobalt = module.createOwnerClarityUpscaleFixture();
  const emerald = module.createOwnerClarityUpscaleEmeraldFixture();
  assert.deepEqual([amber.filename, amber.mime_type, amber.width, amber.height], [
    "clarity-amber-checker-upscale-v2.png", "image/png", 512, 512
  ]);
  assert.equal(amber.sha256, "sha256:58694e9a0ab6a83ec207ab25583766d89d8377ae97c221fcc0d04c0e806fca3f");
  assert.equal(amber.pixel_sha256, "sha256:5d9a843d7986f3e047fd4f37561940d8c85d5c3d82bf849e6a65a4a66d5e17cd");
  assert.notEqual(emerald.sha256, amber.sha256);
  assert.notEqual(emerald.pixel_sha256, amber.pixel_sha256);
  assert.notEqual(emerald.sha256, cobalt.sha256);
  assert.notEqual(emerald.pixel_sha256, cobalt.pixel_sha256);
  assert.equal(module.OWNER_CLARITY_UPSCALE_CASE_ID, FRESH_CASE_ID);
  assert.deepEqual(module.OWNER_CLARITY_UPSCALE_CASE.parameters, {
    professional_mode: false, scale_factor: 2, strength: 0.35, cfg: 6, denoise: 0.25
  });
  assert.equal(module.OWNER_CLARITY_UPSCALE_CASE.prompt, null);
});

test("safe intent metadata binds source, requested settings and fixture hashes without prompt or image bytes", async () => {
  const module = await load();
  const fixture = module.createOwnerClarityUpscaleEmeraldFixture();
  const source = Object.freeze({
    profile_id: "clarity-upscale-source-reviewed-v1", model_id: "clarity",
    profile_schema_hash: `sha256:${"1".repeat(64)}`,
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354",
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444",
    source_binding: Object.freeze({
      public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
    }),
    source_fingerprint: `sha256:${"2".repeat(64)}`
  });
  const harnessSha256 = `sha256:${"3".repeat(64)}`;
  const metadata = module.buildOwnerClarityUpscaleSafeIntentMetadata({ fixture, source, harnessSha256 });
  assert.equal(metadata.safeBase.case_id, FRESH_CASE_ID);
  assert.deepEqual(metadata.safeBase.parameters, {
    professional_mode: false, scale_factor: 2, strength: 0.35, cfg: 6, denoise: 0.25
  });
  assert.deepEqual(metadata.safeBase.expected_output_geometry, { width: 1024, height: 1024 });
  assert.equal(metadata.safeBase.prompt_included, false);
  assert.equal(metadata.safeBase.fixture_sha256, fixture.sha256);
  assert.equal(metadata.safeBase.fixture_pixel_sha256, fixture.pixel_sha256);
  assert.equal(metadata.safeBase.runtime_node_version, process.versions.node);
  assert.equal(metadata.safeBase.harness_sha256, harnessSha256);
  assert.equal(metadata.safeBase.harness_sha256, harnessSha256);
  assert.match(metadata.actionFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(module.buildOwnerClarityUpscaleSafeIntentMetadata({
    fixture, source, harnessSha256: `sha256:${"9".repeat(64)}`
  }).actionFingerprint, metadata.actionFingerprint);
  assert.notEqual(module.buildOwnerClarityUpscaleSafeIntentMetadata({
    fixture, source: Object.freeze({ ...source, profile_schema_hash: `sha256:${"8".repeat(64)}` }), harnessSha256
  }).actionFingerprint, metadata.actionFingerprint);
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(fixture.bytes.toString("base64")), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("caller-selected"), false);
  assert.throws(() => module.buildOwnerClarityUpscaleSafeIntentMetadata({
    fixture: { ...fixture, filename: "caller.png" }, source, harnessSha256
  }), /SAFE_INTENT_METADATA_INVALID/u);
});

test("dry-run and description produce fixed metadata without starting owner stdio or private IPC", async () => {
  const module = await load();
  const source = pinnedSourceForTest();
  let childStarts = 0;
  let privateCalls = 0;
  let journalWrites = 0;
  const dependencies = {
    loadClarityUpscaleSource: async () => source,
    harnessSha256: `sha256:${"4".repeat(64)}`,
    operatorJournal: { async append() { journalWrites += 1; } },
    createOwnerClient: async () => { childStarts += 1; throw new Error("must not start a child"); },
    sendPrivateIpc: async () => { privateCalls += 1; return true; },
    waitForPrivateAction: async () => { privateCalls += 1; return null; }
  };
  const described = await module.runOwnerClarityUpscaleSmoke(module.parseOwnerClarityUpscaleSmokeArgs(["--describe"]), process, dependencies);
  const dry = await module.runOwnerClarityUpscaleSmoke(module.parseOwnerClarityUpscaleSmokeArgs(["--dry-run"]), process, dependencies);
  assert.equal(described.status, "DESCRIPTION");
  assert.equal(dry.status, "DRY_RUN_READY");
  assert.equal(dry.fixture_width, 512);
  assert.equal(dry.fixture_height, 512);
  assert.equal(dry.fixture_sha256, module.createOwnerClarityUpscaleEmeraldFixture().sha256);
  assert.deepEqual(dry.expected_output_geometry, { width: 1024, height: 1024 });
  assert.equal(dry.prompt_included, false);
  assert.equal(dry.auth_calls, 0);
  assert.equal(dry.mutation_calls.upload, 0);
  assert.equal(dry.mutation_calls.generation, 0);
  assert.equal(childStarts, 0);
  assert.equal(privateCalls, 0);
  assert.equal(journalWrites, 0);
  const serialized = JSON.stringify(dry);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("clarity_image_"), false);
});

test("read-only startup proves default-off and opted-in tools with no login or mutation calls", async () => {
  const module = await load();
  const childOptions = [];
  let authOrMutationCalls = 0;
  let journalWrites = 0;
  const dependencies = {
    isSourceCheckout: () => true,
    operatorJournal: { async append() { journalWrites += 1; } },
    async createOwnerClient(options) {
      childOptions.push(options);
      const enabled = options.env.SYNTX_OWNER_CLARITY_UPSCALE === "1";
      const names = ["syntx_begin_login", "syntx_check_login", "syntx_unlink"];
      if (enabled) names.push(...module.OWNER_CLARITY_UPSCALE_TOOL_NAMES);
      return {
        client: {
          async listTools() { return { tools: names.map((name) => ({ name })) }; },
          async callTool() { authOrMutationCalls += 1; throw new Error("read-only startup must not call a tool"); },
          async close() {}
        },
        async waitForExit() { return true; }
      };
    }
  };
  const result = await module.runOwnerClarityUpscaleSmoke(module.parseOwnerClarityUpscaleSmokeArgs(["--read-only"]), process, dependencies);
  assert.equal(result.status, "READ_ONLY_SURFACE_PASS");
  assert.deepEqual(result.surfaces.map(({ mode, status, clarity_tool_count }) => ({ mode, status, clarity_tool_count })), [
    { mode: "default_off", status: "PASS", clarity_tool_count: 0 },
    { mode: "opted_in", status: "PASS", clarity_tool_count: 4 }
  ]);
  assert.equal(childOptions.length, 2);
  assert.deepEqual(childOptions.map(({ env }) => env), [
    { SYNTX_OWNER_CLARITY_UPSCALE: "0", SYNTX_OWNER_ACCOUNT_STATUS: "0" },
    { SYNTX_OWNER_CLARITY_UPSCALE: "1", SYNTX_OWNER_ACCOUNT_STATUS: "0" }
  ]);
  assert.equal(authOrMutationCalls, 0);
  assert.equal(result.auth_calls, 0);
  assert.equal(result.mutation_calls.upload, 0);
  assert.equal(result.mutation_calls.generation, 0);
  assert.equal(journalWrites, 0);
  assert.ok(result.cleanup.every(({ client_closed, child_closed }) => client_closed && child_closed));
});

test("one fixed synthetic case ACK-binds READ, one upload, one generation, safe result and cleanup", async () => {
  const module = await load();
  const h = fakeLiveHarness(module);
  const config = module.createOwnerClarityUpscaleInternalFixtureConfig();
  const result = await module.runOwnerClarityUpscaleSmoke(config, {}, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(result.generation_result.backend_acceptance, "unproven");
  assert.deepEqual(h.calls.map((call) => call.name), [
    "syntx_begin_login", "syntx_check_login", "syntx_get_account_status",
    "syntx_upload_clarity_upscale_image", "syntx_owner_generate_clarity_upscale_image",
    "syntx_unlink", "syntx_check_login"
  ]);
  const upload = h.calls.find(({ name }) => name === "syntx_upload_clarity_upscale_image").arguments;
  assert.deepEqual(Object.keys(upload).sort(), ["content_base64", "filename", "link_attempt_id", "mime_type"]);
  assert.equal(upload.filename, "clarity-emerald-bars-upscale-v3.png");
  assert.equal(upload.link_attempt_id, h.attempt_id);
  assert.equal(Buffer.from(upload.content_base64, "base64").equals(h.fixture.bytes), true);
  const generation = h.calls.find(({ name }) => name === "syntx_owner_generate_clarity_upscale_image").arguments;
  assert.equal(generation.link_attempt_id, h.attempt_id);
  assert.equal(generation.image_handle, h.image_handle);
  assert.deepEqual(generation.parameters, {
    professional_mode: false, scale_factor: 2, strength: 0.35, cfg: 6, denoise: 0.25
  });
  assert.equal("prompt" in generation, false);
  assert.equal("model_type" in generation.parameters, false);
  assert.equal("n" in generation.parameters, false);
  assert.deepEqual(h.privateEvents.map(({ event }) => event), ["BEGIN", "READ_INTENT", "UPLOAD_INTENT", "GENERATION_INTENT"]);
  for (const event of h.privateEvents) {
    assert.equal(event.attempt_id, h.attempt_id);
    assert.match(event.intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  }
  assert.equal(h.privateEvents[0].handoff_uri, h.handoff_uri);
  assert.equal(h.privateEvents[0].case_id, FRESH_CASE_ID);
  assert.equal(h.privateEvents[0].fixture_sha256, h.fixture.sha256);
  assert.equal(h.privateEvents[0].fixture_pixel_sha256, h.fixture.pixel_sha256);
  assert.equal(h.privateEvents[0].runtime_node_version, process.versions.node);
  assert.equal(h.privateEvents[0].harness_sha256, h.dependencies.harnessSha256);
  assert.equal(new Set(h.privateEvents.map(({ intent_fingerprint }) => intent_fingerprint)).size, 4);
  assert.equal(h.privateEvents.some((event) => JSON.stringify(event).includes(h.image_handle)), false);
  assert.equal(h.privateEvents.some((event) => JSON.stringify(event).includes(h.artifact_url)), false);
  assert.deepEqual(h.observedArtifact, { url: h.artifact_url, mime_type: "image/png" });
  assert.deepEqual(result.artifact_observation, {
    status: "OBSERVED", mime: "image/png", byte_size: 4000, width: 1024, height: 1024,
    sha256: `sha256:${"5".repeat(64)}`
  });
  assert.equal(result.stdout_includes_private_data, false);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.child_close_status, "CLOSED");
  assert.deepEqual(h.journalRecords.map(({ stage }) => stage), ["GENERATION_DISPATCH_POSSIBLE", "FINAL_OUTCOME"]);
  assert.equal(h.journalRecords[0].generation_call_count, 0);
  assert.equal(h.journalRecords[0].outcome, "DISPATCH_POSSIBLE");
  assert.equal(h.journalRecords[1].generation_call_count, 1);
  assert.equal(h.journalRecords[1].outcome, "RESULT_OBSERVED_CLEANUP_CONFIRMED");
  const journalText = JSON.stringify(h.journalRecords);
  for (const privateValue of [h.attempt_id, h.handoff_uri, h.image_handle, h.recovery_id, h.artifact_url,
    h.fixture.bytes.toString("base64")]) assert.equal(journalText.includes(privateValue), false);
});

test("journal failure before generation fails closed after upload and still cleans up", async () => {
  const module = await load();
  const h = fakeLiveHarness(module);
  h.dependencies.operatorJournal = Object.freeze({ async append() { throw new Error("private journal failure"); } });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "GENERATION_JOURNAL_FAILED");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(h.calls.some(({ name }) => name === "syntx_owner_generate_clarity_upscale_image"), false);
  assert.equal(result.failure_code, "OPERATOR_JOURNAL_WRITE_FAILED");
  assert.equal(JSON.stringify(result).includes("private journal failure"), false);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.child_close_status, "CLOSED");
  assert.deepEqual(h.journalRecords, []);
});

test("journal failure after possible generation leaves unknown outcome and never retries", async () => {
  const module = await load();
  const h = fakeLiveHarness(module);
  let appendCount = 0;
  h.dependencies.operatorJournal = Object.freeze({ async append(record) {
    appendCount += 1;
    if (appendCount === 2) throw new Error("private final journal failure");
    h.journalRecords.push(record);
  } });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(result.failure_code, "OPERATOR_JOURNAL_WRITE_FAILED");
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.generation_result, null);
  assert.equal(result.retry_count, 0);
  assert.equal(result.recovery_call_count, 0);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_generate_clarity_upscale_image").length, 1);
  assert.equal(JSON.stringify(result).includes("private final journal failure"), false);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
});

test("parent disconnect wakes a pending private ACK and prevents the next stage", async () => {
  const module = await load();
  let announceBeginIntent;
  let ackAbortCount = 0;
  const beginIntentSent = new Promise((resolvePromise) => { announceBeginIntent = resolvePromise; });
  const h = fakeLiveHarness(module, { pendingAckEvent: "BEGIN", onPrivateEvent: (event) => {
    if (event.event === "BEGIN") announceBeginIntent();
  }, onAckAbort: () => { ackAbortCount += 1; } });
  const operatorParent = new EventEmitter();
  const run = module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), operatorParent, h.dependencies);
  await beginIntentSent;
  operatorParent.emit("disconnect");
  let timeout;
  const result = await Promise.race([run, new Promise((resolvePromise) => { timeout = setTimeout(() => resolvePromise(null), 100); })]);
  clearTimeout(timeout);
  assert.notEqual(result, null, "disconnect must wake the waiting private ACK");
  assert.equal(result.status, "OPERATOR_PARENT_DISCONNECTED");
  assert.equal(ackAbortCount, 1);
  assert.equal(h.calls.some(({ name }) => name === "syntx_get_account_status"), false);
  assert.equal(h.calls.some(({ name }) => name === "syntx_upload_clarity_upscale_image"), false);
  assert.equal(h.calls.some(({ name }) => name === "syntx_owner_generate_clarity_upscale_image"), false);
  assert.deepEqual(h.journalRecords.map(({ stage, outcome }) => ({ stage, outcome })), [
    { stage: "FINAL_OUTCOME", outcome: "PRE_GENERATION_FAILED" }
  ]);
});

test("operator journal is private, append-only, exact-schema and rejects injected private values", async () => {
  const module = await load();
  assert.throws(() => module.createOwnerClarityOperatorJournalForTests(
    resolve(".autopilot/owner-clarity-operator")
  ), /TEST_JOURNAL_DIRECTORY_INVALID/u);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "syntx-clarity-journal-"));
  try {
    const journalDirectory = join(temporaryRoot, "journal");
    const journal = module.createOwnerClarityOperatorJournalForTests(journalDirectory);
    const checkpoint = {
      case_id: FRESH_CASE_ID,
      source_fingerprint: `sha256:${"1".repeat(64)}`,
      profile_schema_hash: `sha256:${"2".repeat(64)}`,
      fixture_sha256: `sha256:${"3".repeat(64)}`,
      fixture_pixel_sha256: `sha256:${"4".repeat(64)}`,
      harness_sha256: `sha256:${"5".repeat(64)}`,
      runtime_node_version: process.versions.node,
      action_fingerprint: `sha256:${"6".repeat(64)}`,
      stage: "GENERATION_DISPATCH_POSSIBLE",
      outcome: "DISPATCH_POSSIBLE",
      upload_call_count: 1, generation_call_count: 0, recovery_discovery_call_count: 0,
      recovery_call_count: 0, artifact_observation_count: 0, retry_count: 0,
      generation_diagnostic: null,
      local_unlink_status: "NOT_ATTEMPTED", client_close_status: "NOT_ATTEMPTED", child_close_status: "NOT_ATTEMPTED"
    };
    await journal.append(checkpoint);
    const firstNames = await readdir(journalDirectory);
    assert.equal(firstNames.length, 1);
    const firstPath = join(journalDirectory, firstNames[0]);
    const firstText = await readFile(firstPath, "utf8");
    const firstRecord = JSON.parse(firstText);
    assert.equal((await stat(journalDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(firstPath)).mode & 0o777, 0o600);
    assert.equal(firstRecord.stage, "GENERATION_DISPATCH_POSSIBLE");
    assert.deepEqual(Object.keys(firstRecord).sort(), [
      "action_fingerprint", "artifact_observation_count", "case_id", "child_close_status", "client_close_status",
      "fixture_pixel_sha256", "fixture_sha256", "generation_call_count", "generation_diagnostic", "harness_sha256",
      "local_unlink_status", "outcome", "profile_schema_hash", "recorded_at_utc", "recovery_call_count",
      "recovery_discovery_call_count", "retry_count", "runtime_node_version", "schema_version", "source_fingerprint",
      "stage", "upload_call_count"
    ]);
    assert.equal(firstText.includes("https://"), false);
    await journal.append({ ...checkpoint, stage: "FINAL_OUTCOME", outcome: "OUTCOME_UNKNOWN", generation_call_count: 1,
      local_unlink_status: "UNCONFIRMED", client_close_status: "UNCONFIRMED", child_close_status: "UNCONFIRMED" });
    const finalNames = await readdir(journalDirectory);
    assert.equal(finalNames.length, 2);
    assert.ok(finalNames.includes(firstNames[0]));
    assert.equal(await readFile(firstPath, "utf8"), firstText);
    await assert.rejects(journal.append({ ...checkpoint, private_prompt: "private journal sentinel" }), /OPERATOR_JOURNAL_RECORD_INVALID/u);
    assert.equal((await readdir(journalDirectory)).length, 2);
    assert.equal(firstText.includes("private journal sentinel"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("parent disconnect during generation wakes the run and prevents recovery or another stage", async () => {
  const module = await load();
  let announceGenerationStart;
  const generationStarted = new Promise((resolvePromise) => { announceGenerationStart = resolvePromise; });
  const h = fakeLiveHarness(module, { generationPending: true, onGenerationStarted: announceGenerationStart });
  const operatorParent = new EventEmitter();
  const run = module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), operatorParent, h.dependencies);
  await generationStarted;
  operatorParent.emit("disconnect");
  let timeout;
  const result = await Promise.race([run, new Promise((resolvePromise) => { timeout = setTimeout(() => resolvePromise(null), 100); })]);
  clearTimeout(timeout);
  assert.notEqual(result, null, "disconnect must not leave the operator waiting for the SDK deadline");
  assert.equal(result.status, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_discovery_call_count, 0);
  assert.equal(result.recovery_call_count, 0);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_generate_clarity_upscale_image").length, 1);
  assert.equal(h.calls.some(({ name }) => name === "syntx_owner_list_clarity_upscale_recoveries"), false);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.child_close_status, "CLOSED");
  assert.deepEqual(h.journalRecords.map(({ stage, outcome }) => ({ stage, outcome })), [
    { stage: "GENERATION_DISPATCH_POSSIBLE", outcome: "DISPATCH_POSSIBLE" },
    { stage: "FINAL_OUTCOME", outcome: "OUTCOME_UNKNOWN" }
  ]);
});

test("current upload contract rejects decoded-pixel claims and historical partial-coverage receipts", async () => {
  const module = await load();
  const historicalCoverage = {
    source_mime_types: ["image/jpeg", "image/png", "image/avif", "image/webp"], source_max_bytes: 25 * 1024 * 1024,
    implemented_mime_types: ["image/jpeg", "image/png", "image/webp"], implemented_max_bytes: 7 * 1024 * 1024,
    status: "PARTIAL_AVIF_AND_7_TO_25_MIB_UNSUPPORTED", upload_destination: "uploaded",
    destination_source_binding: "root347_clarity_default_upload"
  };
  for (const options of [
    { metadataConfidence: "PIXELS_DECODED" },
    { coverage: historicalCoverage }
  ]) {
    const h = fakeLiveHarness(module, options);
    const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
    assert.equal(result.status, "UPLOAD_RECEIPT_INVALID");
    assert.equal(result.upload_call_count, 1);
    assert.equal(result.generation_call_count, 0);
    assert.equal(result.retry_count, 0);
    assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
    assert.equal(result.child_close_status, "CLOSED");
  }
});

test("a wrong upload ACK prevents upload and always unlinks/closes", async () => {
  const module = await load();
  const h = fakeLiveHarness(module, { wrongAckEvent: "UPLOAD_INTENT" });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "UPLOAD_NOT_APPROVED");
  assert.equal(result.upload_call_count, 0);
  assert.equal(result.generation_call_count, 0);
  assert.deepEqual(h.calls.map(({ name }) => name), [
    "syntx_begin_login", "syntx_check_login", "syntx_get_account_status", "syntx_unlink", "syntx_check_login"
  ]);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.child_close_status, "CLOSED");
});

test("lost upload reply is not retried and never reaches generation", async () => {
  const module = await load();
  const h = fakeLiveHarness(module, { uploadThrows: true });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_upload_clarity_upscale_image").length, 1);
  assert.equal(h.calls.some(({ name }) => name === "syntx_owner_generate_clarity_upscale_image"), false);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
});

test("known OUTCOME_UNKNOWN recovery uses one scoped GET reconciliation and never reposts", async () => {
  const module = await load();
  const h = fakeLiveHarness(module, { generationUnknown: true, recoveryAction: "reconcile" });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_generate_clarity_upscale_image").length, 1);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_reconcile_clarity_upscale_image").length, 1);
  assert.equal(result.stdout_includes_private_data, false);
});

test("generation and GET-only reconcile use bounded 200-second SDK budgets while short tools stay at 15 seconds", async () => {
  const module = await load();
  const h = fakeLiveHarness(module, { generationUnknown: true, recoveryAction: "reconcile" });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  for (const name of ["syntx_owner_generate_clarity_upscale_image", "syntx_owner_reconcile_clarity_upscale_image"]) {
    const call = h.calls.find((entry) => entry.name === name);
    assert.deepEqual(call?.sdkOptions, { timeout: 200_000, maxTotalTimeout: 200_000 });
  }
  for (const call of h.calls.filter((entry) => ![
    "syntx_owner_generate_clarity_upscale_image", "syntx_owner_reconcile_clarity_upscale_image"
  ].includes(entry.name))) {
    assert.deepEqual(call.sdkOptions, { timeout: 15_000, maxTotalTimeout: 15_000 });
  }
});

test("lost SDK generation reply discovers one recent scoped handle then performs GET-only reconciliation", async () => {
  const module = await load();
  const h = fakeLiveHarness(module, { generationThrows: true, recoveryAction: "reconcile", listUniqueRecovery: true });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_discovery_call_count, 1);
  assert.equal(result.recovery_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_generate_clarity_upscale_image").length, 1);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_list_clarity_upscale_recoveries").length, 1);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_reconcile_clarity_upscale_image").length, 1);
  assert.equal(result.stdout_includes_private_data, false);
});

test("expired opaque recovery entries are not reconciled or replayed", async () => {
  const module = await load();
  const h = fakeLiveHarness(module, { generationThrows: true, listUniqueRecovery: true,
    recoveryCreatedAt: new Date(1_800_000_000_000 - 900_000 - 60_001).toISOString() });
  const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
  assert.equal(result.status, "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE");
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_discovery_call_count, 1);
  assert.equal(result.recovery_call_count, 0);
  assert.equal(result.retry_count, 0);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_owner_generate_clarity_upscale_image").length, 1);
  assert.equal(h.calls.some(({ name }) => name === "syntx_owner_reconcile_clarity_upscale_image"), false);
  assert.equal(result.generation_result, null);
});

test("safe summary carries only a validated closed diagnostic from error or recovery readback", async () => {
  const module = await load();
  const cases = [
    { options: { generationUnknown: true, recoveryAction: "reconcile", generationDiagnostic: SAFE_UNKNOWN_DIAGNOSTIC } },
    { options: { generationThrows: true, listUniqueRecovery: true, recoveryAction: "reconcile", recoveryDiagnostic: SAFE_UNKNOWN_DIAGNOSTIC } }
  ];
  for (const { options } of cases) {
    const h = fakeLiveHarness(module, options);
    const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
    assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
    assert.deepEqual(result.generation_diagnostic, SAFE_UNKNOWN_DIAGNOSTIC);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("ROOT359"), false);
    assert.equal(serialized.includes(h.recovery_id), false);
    assert.equal(serialized.includes(h.image_handle), false);
    assert.equal(serialized.includes(h.artifact_url), false);
    assert.equal(serialized.includes("private prompt"), false);
    assert.equal(result.stdout_includes_private_data, false);
  }
});

test("safe summary preserves each exact closed history rejection reason and nullable current-scope value", async () => {
  const module = await load();
  const reasons = [
    "SNAPSHOT_PARSE_FAILED", "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID", "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID",
    "PAGE_INCOMPLETE", "REQUESTED_CHAT_MISMATCH", "PROVIDER_CHAT_ID_INVALID",
    "TOTAL_COUNT_MISMATCH", "TOTAL_PAGES_MISMATCH", "MESSAGE_ID_INVALID", "PROVIDER_CHAT_MISMATCH",
    "AUTHOR_ROLE_INVALID", "OWNER_ECHO_MISSING", "OWNER_ECHO_AMBIGUOUS", "OWNER_ECHO_AUTHOR_MISMATCH",
    "OWNER_ECHO_OBJECT_INVALID", "MESSAGE_CARDINALITY_INVALID", "BOT_CANDIDATE_CARDINALITY_INVALID",
    "BOT_OBJECT_INVALID"
  ];
  for (const reason of [null, ...reasons]) {
    const diagnostic = { ...SAFE_UNKNOWN_DIAGNOSTIC,
      phase: reason === null ? "HISTORY_GET" : "HISTORY_BINDING",
      history_binding: reason === null ? "NOT_RUN" : "INVALID",
      history_binding_reason: reason };
    const h = fakeLiveHarness(module, { generationUnknown: true, recoveryAction: "reconcile", generationDiagnostic: diagnostic });
    const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
    assert.equal(result.generation_diagnostic?.history_binding_reason, reason);
    assert.deepEqual(Object.keys(result.generation_diagnostic ?? {}).sort(), [
      "echo_ack_known", "history_binding", "history_binding_reason", "history_get_count", "history_get_count_capped",
      "history_get_eligible", "history_get_performed", "phase", "result_get_count", "result_get_count_capped",
      "result_get_performed", "unverified_reason", "upstream_error_code"
    ]);
  }
});

test("invalid diagnostic enums, bounds, codes, and unknown fields are omitted from summaries", async () => {
  const module = await load();
  const invalidDiagnostics = [
    { ...SAFE_UNKNOWN_DIAGNOSTIC, phase: "ROOT359_SOURCE_UNKNOWN" },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, history_get_count: 256 },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, upstream_error_code: "UPLOAD_RECEIPT_INVALID" },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, history_binding_reason: "UNKNOWN_REASON" },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, history_binding_reason: "REQUESTED_CHAT_MISMATCH" },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, private_prompt: "must not persist" }
  ];
  const { history_binding_reason: _legacyReason, ...legacy12FieldDiagnostic } = SAFE_UNKNOWN_DIAGNOSTIC;
  invalidDiagnostics.push(legacy12FieldDiagnostic);
  for (const generationDiagnostic of invalidDiagnostics) {
    const h = fakeLiveHarness(module, { generationUnknown: true, recoveryAction: "reconcile", generationDiagnostic });
    const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
    assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
    assert.equal(result.generation_diagnostic, null);
    assert.equal(JSON.stringify(result).includes("must not persist"), false);
    assert.equal(JSON.stringify(result).includes("ROOT359_SOURCE_UNKNOWN"), false);
  }
});

test("proxy and accessor recovery diagnostics are rejected without invoking getters", async () => {
  const module = await load();
  let getterCalls = 0;
  const accessorDiagnostic = { ...SAFE_UNKNOWN_DIAGNOSTIC };
  Object.defineProperty(accessorDiagnostic, "history_get_count", {
    enumerable: true, configurable: true, get() { getterCalls += 1; return 1; }
  });
  const proxyDiagnostic = new Proxy({ ...SAFE_UNKNOWN_DIAGNOSTIC }, {});
  for (const recoveryDiagnostic of [accessorDiagnostic, proxyDiagnostic]) {
    const h = fakeLiveHarness(module, {
      generationThrows: true, listUniqueRecovery: true, recoveryAction: "reconcile", recoveryDiagnostic
    });
    const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
    assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
    assert.equal(result.generation_diagnostic, null);
  }
  assert.equal(getterCalls, 0);
});

test("observed pixels with the wrong geometry never count as fulfillment", async (t) => {
  const module = await load();
  for (const [width, height] of [[512, 512], [1024, 768]]) {
    await t.test(`${width}x${height} retained as observed, but fixed 1024-square case is not fulfilled`, async () => {
      const h = fakeLiveHarness(module, { outputWidth: width, outputHeight: height });
      const result = await module.runOwnerClarityUpscaleSmoke(module.createOwnerClarityUpscaleInternalFixtureConfig(), {}, h.dependencies);
      assert.equal(result.status, "ARTIFACT_GEOMETRY_MISMATCH");
      assert.deepEqual([result.artifact_observation.width, result.artifact_observation.height], [width, height]);
      assert.equal(result.artifact_observation.status, "OBSERVED");
      assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
      assert.equal(result.client_close_status, "CLOSED");
      assert.equal(result.child_close_status, "CLOSED");
      assert.equal(result.upload_call_count, 1);
      assert.equal(result.generation_call_count, 1);
      assert.equal(result.retry_count, 0);
    });
  }
});

function pinnedSourceForTest() {
  const sourceBinding = Object.freeze({
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
  });
  return Object.freeze({
    profile_id: "clarity-upscale-source-reviewed-v1", model_id: "clarity",
    profile_schema_hash: `sha256:${"1".repeat(64)}`,
    public_catalog_version: sourceBinding.public_catalog_version,
    catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354",
    public_models_sha256: sourceBinding.public_models_sha256,
    source_binding: sourceBinding,
    source_fingerprint: `sha256:${"2".repeat(64)}`
  });
}

function fakeLiveHarness(module, options = {}) {
  const fixture = module.createOwnerClarityUpscaleEmeraldFixture();
  const source = pinnedSourceForTest();
  const attempt_id = "link_fake_clarity_smoke_attempt_00000001";
  const handoff_uri = "https://t.me/syntxaibot?start=auth_clarity_smoke_abcdef01";
  const image_handle = "clarity_image_11111111-1111-4111-8111-111111111111";
  const recovery_id = "clarity_recovery_22222222-2222-4222-8222-222222222222";
  const artifact_url = "https://r2.syntx.ai/private/clarity-smoke-result.png?sig=private";
  const calls = [];
  const privateEvents = [];
  const journalRecords = [];
  let observedArtifact;
  let revoked = false;
  const tools = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status",
    ...module.OWNER_CLARITY_UPSCALE_TOOL_NAMES];
  const generatedResult = {
    status: "result_observed", backend_acceptance: "unproven", model_id: "clarity", operation_id: "upscale-image",
    profile_id: source.profile_id, profile_schema_hash: source.profile_schema_hash, catalog_version: source.catalog_version,
    request_fingerprint: `sha256:${"6".repeat(64)}`, requested_scale_factor: 2,
    input_image: { mime_type: "image/png", width: 512, height: 512 },
    expected_output_geometry: { width: 1024, height: 1024 },
    actual_image: { mime_type: "image/png", width: null, height: null }, geometry_verified: false,
    artifact: { url: artifact_url, mime_type: "image/png", mime_confidence: "URL_EXTENSION_ONLY" }
  };
  const client = {
    async listTools() { return { tools: tools.map((name) => ({ name })) }; },
    async callTool({ name, arguments: args = {} }, _resultSchema, sdkOptions) {
      calls.push({ name, arguments: args, sdkOptions });
      if (name === "syntx_begin_login") return {
        structuredContent: { attempt_id }, content: [{ type: "resource_link", uri: handoff_uri }]
      };
      if (name === "syntx_check_login") return { structuredContent: { attempt_id, status: revoked ? "REVOKED" : "LINKED", linked: !revoked } };
      if (name === "syntx_get_account_status") return { structuredContent: { subscription: { active: true, plan_type: "PAID" } } };
      if (name === "syntx_upload_clarity_upscale_image") {
        if (options.uploadThrows) throw new Error("private transport error");
        return { structuredContent: {
        status: "accepted", image_handle, mime_type: "image/png", size: fixture.bytes.length,
        width: 512, height: 512, sha256: fixture.sha256, expires_in_seconds: 900,
        confidence_scope: "input_bytes_sniffed_and_dimensions_checked",
        metadata_confidence: options.metadataConfidence ?? "CONTAINER_METADATA_ONLY",
        upload_destination: "uploaded", destination_source_binding: "root347_clarity_default_upload",
        coverage: options.coverage ?? {
          source_mime_types: ["image/jpeg", "image/png", "image/avif", "image/webp"],
          source_max_bytes: 25 * 1024 * 1024,
          implemented_mime_types: ["image/jpeg", "image/png", "image/avif", "image/webp"],
          implemented_max_bytes: 25 * 1024 * 1024,
          status: "STRUCTURALLY_VALIDATED_NOT_PROVIDER_ACCEPTANCE", upload_destination: "uploaded",
          destination_source_binding: "root347_clarity_default_upload"
        }
      } };
      }
      if (name === "syntx_owner_generate_clarity_upscale_image") {
        if (options.generationPending) { options.onGenerationStarted?.(); return new Promise(() => {}); }
        if (options.generationThrows) throw new Error("private lost SDK reply");
        if (options.generationUnknown) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
          code: "OUTCOME_UNKNOWN", message: "do not expose", recovery_id,
          ...(options.generationDiagnostic === undefined ? {} : { diagnostic: options.generationDiagnostic })
        } }) }] };
        return { structuredContent: generatedResult };
      }
      if (name === "syntx_owner_reconcile_clarity_upscale_image") return { structuredContent: generatedResult };
      if (name === "syntx_owner_list_clarity_upscale_recoveries") return { structuredContent: {
        recoveries: options.listUniqueRecovery ? [{
        recovery_id, created_at: options.recoveryCreatedAt ?? new Date(1_800_000_000_000).toISOString(), model_id: "clarity",
        operation_id: "upscale-image", status: "OUTCOME_UNKNOWN",
        diagnostic: options.recoveryDiagnostic ?? SAFE_UNKNOWN_DIAGNOSTIC
        }] : [], confidence_scope: "process_local_get_only_recovery", expires_in_seconds: 900
      } };
      if (name === "syntx_owner_reconcile_clarity_upscale_image") return { isError: true, content: [{ type: "text", text: "{}" }] };
      if (name === "syntx_unlink") { revoked = true; return { structuredContent: { status: "REVOKED" } }; }
      return { isError: true, content: [{ type: "text", text: "{}" }] };
    },
    async close() {}
  };
  return {
    fixture, attempt_id, handoff_uri, image_handle, recovery_id, artifact_url, calls, privateEvents, journalRecords,
    dependencies: {
      isSourceCheckout: () => true,
      loadClarityUpscaleSource: async () => source,
      createFixture: () => fixture,
      harnessSha256: `sha256:${"4".repeat(64)}`,
      operatorJournal: Object.freeze({ async append(record) { journalRecords.push(record); } }),
      createOwnerClient: async (childOptions) => ({
        client, childOptions,
        async waitForExit() { return true; }
      }),
      sendPrivateIpc: async (message) => { privateEvents.push(message); options.onPrivateEvent?.(message); return true; },
      waitForPrivateAction: async (event, context, _timeoutMs, signal) => {
        if (options.pendingAckEvent === event) return new Promise((resolvePromise) => {
          signal?.addEventListener("abort", () => { options.onAckAbort?.(event); resolvePromise(null); }, { once: true });
        });
        return {
          action: options.wrongAckEvent === event ? "wrong_ack" : { BEGIN: "handoff_sent", READ_INTENT: "approve_read", UPLOAD_INTENT: "approve_upload",
            GENERATION_INTENT: "approve_generation", RECOVERY_DISCOVERY_INTENT: "discover",
            RECOVERY_ACTION: options.recoveryAction ?? "finish" }[event],
          ...context, ...(event === "BEGIN" ? { attempt_id } : {})
        };
      },
      observeOwnedImageArtifact: async (input) => {
        observedArtifact = input.artifacts[0];
        return { status: "OBSERVED", mime: "image/png", declared_mime: "image/png", byte_size: 4000,
          width: options.outputWidth ?? 1024, height: options.outputHeight ?? 1024,
          sha256: `sha256:${"5".repeat(64)}` };
      },
      now: () => 1_800_000_000_000,
      sleep: async () => {}
    },
    get observedArtifact() { return observedArtifact; }
  };
}
