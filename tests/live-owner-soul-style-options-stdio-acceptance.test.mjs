import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT = resolve("scripts/live-owner-soul-style-options-stdio-acceptance.mjs");
const CASE_ID = "soul-style-options-readonly";
const CONFIRM = "--confirm-owner-soul-style-options-stdio-acceptance";
let modulePromise;

async function loadHarness() {
  assert.equal(existsSync(SCRIPT), true, "fixed owner-only style options harness must exist");
  return modulePromise ??= import(pathToFileURL(SCRIPT).href);
}

test("CLI accepts only the exact source-only style read case", async () => {
  const harness = await loadHarness();
  const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([
    CONFIRM, "--real", "--case", CASE_ID
  ]);
  assert.equal(config?.caseId, CASE_ID);

  for (const args of [
    [], ["--real", "--case", CASE_ID],
    [CONFIRM, "--real", "--case", "other"],
    [CONFIRM, "--real", "--case", CASE_ID, "--kind", "characters"],
    [CONFIRM, "--real", "--case", CASE_ID, "--url", "https://attacker.invalid"],
    [CONFIRM, "--real", "--case", CASE_ID, "--prompt", "caller text"],
    ["--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", CASE_ID]
  ]) assert.equal(harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs(args), null);
});

const ATTEMPT = "link_fake_soul_style_attempt_000001";
const HANDOFF = "https://t.me/syntxaibot?start=auth_private_handoff_token";
const TOOL = "syntx_list_owner_soul_style_options";
const SOURCE_SHA = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";
const CATALOG = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

function styleOutput(overrides = {}) {
  return {
    status: "OPTIONS_ISSUED",
    model_id: "higgsfield-soul",
    catalog_version: CATALOG,
    confidence_scope: "owner_authenticated_source_reviewed_style_options",
    source_reviewed: true,
    source_mapping_sha256: SOURCE_SHA,
    generation_allowed: false,
    expires_in_seconds: 300,
    options: [
      { style_handle: "soul_style_123e4567-e89b-42d3-a456-426614174000", label: "Private Style One" },
      { style_handle: "soul_style_123e4567-e89b-42d3-a456-426614174001", label: "Private Style Two" }
    ],
    summary: {
      route: "hf/lora/styles", response_bytes: 900, record_count: 2, total_matches: true,
      unique_ids: true, fields_valid: true, unknown_top_level_key_count: 0, unknown_item_key_count: 2,
      style_id_utf8_bytes: { min: 12, max: 13 }, name_utf8_bytes: { min: 16, max: 16 }
    },
    ...overrides
  };
}

function fakeHarness({ response = { structuredContent: styleOutput() }, mismatch = null, toolPresent = true } = {}) {
  const calls = [];
  const privateEvents = [];
  const client = {
    async listTools() {
      const names = ["syntx_begin_login", "syntx_check_login", "syntx_unlink"];
      if (toolPresent) names.push(TOOL);
      return { tools: names.map((name) => ({ name })) };
    },
    async callTool(request) {
      calls.push({ name: request.name, arguments: request.arguments });
      if (request.name === "syntx_begin_login") return {
        structuredContent: { attempt_id: ATTEMPT },
        content: [{ type: "resource_link", uri: HANDOFF }]
      };
      if (request.name === "syntx_check_login") return { structuredContent: {
        attempt_id: ATTEMPT, status: "LINKED", linked: true
      } };
      if (request.name === "syntx_unlink") return { structuredContent: { attempt_id: ATTEMPT, status: "REVOKED" } };
      if (request.name === TOOL) return response;
      throw new Error("unexpected fake call");
    },
    async close() {}
  };
  return {
    calls, privateEvents,
    dependencies: {
      isSourceCheckout: () => true,
      createOwnerClient: async (options) => ({ client, options, async waitForExit() { return true; } }),
      sendPrivateIpc: async (event) => { privateEvents.push(event); return true; },
      waitForPrivateAction: async (event, context) => ({
        action: event === "BEGIN" ? "handoff_sent" : "approve_read",
        attempt_id: mismatch === "attempt" ? `${ATTEMPT}-foreign` : context.attempt_id,
        intent_fingerprint: mismatch === "fingerprint" ? `sha256:${"0".repeat(64)}` : context.intent_fingerprint
      })
    }
  };
}

function liveFakeHarness({ response = { structuredContent: styleOutput() }, mismatch = null, toolPresent = true } = {}) {
  const calls = [];
  const privateEvents = [];
  const childOptions = [];
  const linkState = { linked: true };
  const names = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", ...(toolPresent ? [TOOL] : [])];
  const client = {
    async listTools() { calls.push({ name: "tools/list" }); return { tools: names.map((name) => ({ name })) }; },
    async callTool(request) {
      calls.push({ name: request.name, arguments: request.arguments });
      if (request.name === "syntx_begin_login") return {
        structuredContent: { attempt_id: ATTEMPT },
        content: [{ type: "resource_link", uri: HANDOFF }]
      };
      if (request.name === "syntx_check_login") return { structuredContent: {
        attempt_id: ATTEMPT, status: linkState.linked ? "LINKED" : "REVOKED", linked: linkState.linked
      } };
      if (request.name === "syntx_unlink") { linkState.linked = false; return { structuredContent: { status: "REVOKED" } }; }
      if (request.name === TOOL) return response;
      throw new Error("unexpected fake call");
    },
    async close() {}
  };
  return {
    calls, privateEvents, childOptions,
    dependencies: {
      isSourceCheckout: () => true,
      createOwnerClient: async (options) => { childOptions.push(options); return { client, async waitForExit() { return true; } }; },
      sendPrivateIpc: async (event) => { privateEvents.push(event); return true; },
      waitForPrivateAction: async (event, context) => ({
        action: event === "BEGIN" ? "handoff_sent" : "approve_read",
        attempt_id: (event === "READ_INTENT" && mismatch === "attempt") ||
          (event === "BEGIN" && mismatch === "begin-attempt") ? `${ATTEMPT}_foreign` : context.attempt_id,
        intent_fingerprint: (event === "READ_INTENT" && mismatch === "fingerprint") ||
          (event === "BEGIN" && mismatch === "begin-fingerprint") ? `sha256:${"0".repeat(64)}` : context.intent_fingerprint
      })
    }
  };
}

test("one linked attempt issues one fixed styles read and prints only safe summary", async () => {
  const harness = await loadHarness();
  const h = liveFakeHarness();
  const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([
    CONFIRM, "--real", "--case", CASE_ID
  ]);
  const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);

  assert.deepEqual(h.calls.filter(({ name }) => ["syntx_begin_login", "syntx_check_login", "syntx_unlink"].includes(name)).map(({ name }) => name),
    ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_check_login"]);
  assert.equal(result.status, "PASS_READONLY_STYLE_OPTIONS_DIAGNOSTIC");
  assert.equal(result.case_id, CASE_ID);
  assert.equal(result.model_id, "higgsfield-soul");
  assert.equal(result.catalog_version, CATALOG);
  assert.equal(result.source_mapping_sha256, SOURCE_SHA);
  assert.equal(result.option_count, 2);
  assert.equal(result.expires_in_seconds, 300);
  assert.equal(result.summary.record_count, 2);
  assert.deepEqual(result.calls, { list_tools: 1, begin_login: 1, check_login: 2, style_options: 1, unlink: 1,
    upload: 0, generation: 0, training: 0, delete: 0, shape: 0 });
  assert.deepEqual(result.cleanup, { local_unlink_status: "REVOKED_READBACK_CONFIRMED", client_close_status: "CLOSED", child_close_status: "CLOSED" });
  assert.deepEqual(h.calls.filter(({ name }) => name === TOOL), [{ name: TOOL, arguments: { link_attempt_id: ATTEMPT } }]);
  assert.deepEqual(h.childOptions[0].env, { SYNTX_OWNER_SOUL_STYLE_OPTIONS: "1" });
  assert.deepEqual(h.childOptions[0].args, [resolve("dist/src/transports/stdio-owner.js")]);
  assert.equal(h.privateEvents.map(({ event }) => event).join(","), "BEGIN,READ_INTENT");
  assert.equal(h.privateEvents[0].attempt_id, ATTEMPT);
  assert.equal(h.privateEvents[1].attempt_id, ATTEMPT);
  assert.equal(h.privateEvents[0].case_id, CASE_ID);
  assert.equal(h.privateEvents[0].catalog_version, CATALOG);
  assert.equal(h.privateEvents[0].source_mapping_sha256, SOURCE_SHA);
  assert.equal(h.privateEvents[1].kind, "styles");
  assert.equal(h.privateEvents[1].tool_name, TOOL);
  assert.match(h.privateEvents[0].intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.match(h.privateEvents[1].intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(h.privateEvents[0].intent_fingerprint, h.privateEvents[1].intent_fingerprint);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_unlink").length, 1);
  assert.equal(h.calls.filter(({ name }) => name === "syntx_check_login").length, 2);
  assert.equal(h.calls.some(({ name }) => /shape|upload|generate|train|delete/iu.test(name)), false);
  const stdout = JSON.stringify(result);
  for (const hidden of [HANDOFF, "Private Style One", "Private Style Two", "soul_style_123e4567", "private-id", "images.invalid", "token"]) {
    assert.equal(stdout.includes(hidden), false);
  }
  assert.equal(Object.hasOwn(result, "options"), false);
});

test("tool absence stops before owner login and performs no style read", async () => {
  const harness = await loadHarness();
  const h = liveFakeHarness({ toolPresent: false });
  const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([CONFIRM, "--real", "--case", CASE_ID]);
  const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);
  assert.equal(result.status, "STYLE_OPTIONS_TOOL_MISSING");
  assert.equal(h.calls.filter(({ name }) => name === "syntx_begin_login").length, 0);
  assert.equal(h.calls.filter(({ name }) => name === TOOL).length, 0);
  assert.equal(result.calls.style_options, 0);
  assert.equal(result.calls.upload, 0);
  assert.equal(result.calls.generation, 0);
  assert.equal(result.cleanup.child_close_status, "CLOSED");
});

test("READ_INTENT mismatch prevents the single fixed style read and still cleans up", async () => {
  const harness = await loadHarness();
  const h = liveFakeHarness({ mismatch: "fingerprint" });
  const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([CONFIRM, "--real", "--case", CASE_ID]);
  const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);
  assert.equal(result.status, "READ_NOT_CONFIRMED");
  assert.deepEqual(h.calls.filter(({ name }) => name === TOOL), []);
  assert.equal(result.calls.style_options, 0);
  assert.equal(result.cleanup.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.cleanup.client_close_status, "CLOSED");
  assert.equal(result.cleanup.child_close_status, "CLOSED");
});

test("BEGIN ACK must bind the exact attempt and fresh case/catalog fingerprint", async () => {
  const harness = await loadHarness();
  for (const mismatch of ["begin-attempt", "begin-fingerprint"]) {
    const h = liveFakeHarness({ mismatch });
    const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([CONFIRM, "--real", "--case", CASE_ID]);
    const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);
    assert.equal(result.status, "BEGIN_NOT_CONFIRMED");
    assert.equal(h.calls.filter(({ name }) => name === TOOL).length, 0);
    assert.equal(h.calls.filter(({ name }) => name === "syntx_check_login").length, 1);
    assert.equal(result.calls.style_options, 0);
    assert.equal(result.cleanup.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  }
});

test("malformed options and empty list are rejected without exposing labels or handles", async () => {
  const harness = await loadHarness();
  for (const response of [
    { structuredContent: styleOutput({ options: [] }) },
    { structuredContent: styleOutput({ extra: "do-not-emit" }) },
    { structuredContent: styleOutput({ options: [{ style_handle: "bad", label: "<secret label>" }] }) },
    { structuredContent: styleOutput({ options: [{ style_handle: "soul_style_123e4567-e89b-42d3-a456-426614174000", label: "bad\nlabel" }] }) },
    { structuredContent: styleOutput({ options: [{ style_handle: "soul_style_123e4567-e89b-42d3-a456-426614174000", label: "x".repeat(257) }] }) },
    { structuredContent: styleOutput({ options: [
      { style_handle: "soul_style_123e4567-e89b-42d3-a456-426614174000", label: "one" },
      { style_handle: "soul_style_123e4567-e89b-42d3-a456-426614174000", label: "two" }
    ] }) },
    { structuredContent: styleOutput({ summary: { ...styleOutput().summary,
      style_id_utf8_bytes: { min: 1, max: 257 } } }) }
  ]) {
    const h = liveFakeHarness({ response });
    const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([CONFIRM, "--real", "--case", CASE_ID]);
    const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);
    assert.equal(result.status, "STYLE_OPTIONS_OUTPUT_INVALID");
    assert.equal(JSON.stringify(result).includes("<secret label>"), false);
    assert.equal(JSON.stringify(result).includes("soul_style_"), false);
    assert.equal(h.calls.filter(({ name }) => name === TOOL).length, 1);
  }
});

test("service errors are reduced to a closed safe code and are never retried", async () => {
  const harness = await loadHarness();
  for (const [upstreamCode, safeCode] of [["UPSTREAM_UNAVAILABLE", "UPSTREAM_UNAVAILABLE"], ["SECRET_RAW_CODE", "TOOL_ERROR"]]) {
    const response = { isError: true, content: [{ type: "text", text: JSON.stringify({
      error: { code: upstreamCode, message: "private response, do not print" }
    }) }] };
    const h = liveFakeHarness({ response });
    const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([CONFIRM, "--real", "--case", CASE_ID]);
    const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);
    assert.equal(result.status, "STYLE_OPTIONS_READ_FAILED");
    assert.equal(result.failure_code, safeCode);
    assert.equal(JSON.stringify(result).includes("private response"), false);
    assert.equal(JSON.stringify(result).includes("SECRET_RAW_CODE"), false);
    assert.equal(h.calls.filter(({ name }) => name === TOOL).length, 1);
    assert.equal(result.calls.style_options, 1);
  }
});

test("proxy and getter output are rejected without evaluating getters", async () => {
  const harness = await loadHarness();
  let getterCalls = 0;
  const proxyOutput = new Proxy({}, { get() { getterCalls += 1; return undefined; } });
  const accessorOutput = {};
  Object.defineProperty(accessorOutput, "status", { enumerable: true, get() { getterCalls += 1; return "OPTIONS_ISSUED"; } });
  for (const structuredContent of [proxyOutput, accessorOutput]) {
    const h = liveFakeHarness({ response: { structuredContent } });
    const config = harness.parseOwnerSoulStyleOptionsStdioAcceptanceArgs([CONFIRM, "--real", "--case", CASE_ID]);
    const result = await harness.runOwnerSoulStyleOptionsStdioAcceptance(config, {}, h.dependencies);
    assert.equal(result.status, "STYLE_OPTIONS_OUTPUT_INVALID");
    assert.equal(getterCalls, 0);
    assert.equal(result.cleanup.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  }
});
