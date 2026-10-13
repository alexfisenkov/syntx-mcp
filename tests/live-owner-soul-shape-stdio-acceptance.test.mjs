import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scriptPath = resolve("scripts/live-owner-soul-shape-stdio-acceptance.mjs");
const CASE_ID = "soul-shape-styles-characters";
const FULL_CASE_ID = "soul-shape-full-styles-characters";
const ATTEMPT_ID = "link_fake_soul_shape_attempt_00000001";
const HANDOFF_URI = "https://t.me/syntxaibot?start=auth_soul_shape_291_abcdefgh";
const TOOL_NAME = "syntx_inspect_owner_soul_catalog_shape";
const SAFE_KEYS = ["items", "data", "styles", "characters", "list", "results", "value", "style_id", "lora_id",
  "reference_id", "id", "name", "image", "status", "model_type", "total", "page", "page_size", "has_more", "next", "count"];
let modulePromise;

async function load() {
  assert.equal(existsSync(scriptPath), true, "the owner Soul shape acceptance harness must exist");
  return modulePromise ??= import(pathToFileURL(scriptPath).href);
}

test("Soul shape CLI accepts only the exact fixed owner-read mode", async () => {
  const module = await load();
  const valid = module.parseOwnerSoulShapeStdioAcceptanceArgs([
    "--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", CASE_ID
  ]);
  assert.ok(valid);
  assert.ok(module.parseOwnerSoulShapeStdioAcceptanceArgs([
    "--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", FULL_CASE_ID
  ]));
  for (const invalid of [
    [], ["--real", "--case", CASE_ID],
    ["--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", "other"],
    ["--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", FULL_CASE_ID, "--max-items", "128"],
    ["--confirm-owner-soul-shape-acceptance", "--mock", "--case", CASE_ID],
    ["--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", CASE_ID, "--kind", "styles"],
    ["--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", CASE_ID, "--url", "https://attacker.invalid"]
  ]) assert.equal(module.parseOwnerSoulShapeStdioAcceptanceArgs(invalid), null);
});

test("one linked owner attempt reads styles then characters once and emits only sanitized shape", async () => {
  const module = await load();
  const h = fakeHarness(module);
  const result = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), h.io, h.dependencies);
  assert.equal(result.status, "PASS_SHAPE_DIAGNOSTIC_ONLY");
  assert.deepEqual(result.reads.map(({ kind }) => kind), ["styles", "characters"]);
  assert.deepEqual(result.reads.map(({ sampling_limit }) => sampling_limit), [20, 20]);
  assert.deepEqual(h.calls.filter((name) => name === TOOL_NAME), [TOOL_NAME, TOOL_NAME]);
  assert.deepEqual(h.shapeArguments, [
    { link_attempt_id: ATTEMPT_ID, kind: "styles" },
    { link_attempt_id: ATTEMPT_ID, kind: "characters" }
  ]);
  assert.equal(h.privateEvents.map(({ event }) => event).join(","), "BEGIN,SOUL_SHAPE_INTENT,SOUL_SHAPE_INTENT");
  assert.equal(h.privateEvents[0].attempt_id, ATTEMPT_ID);
  assert.equal(h.privateEvents[0].handoff_uri, HANDOFF_URI);
  for (const event of h.privateEvents.slice(1)) {
    assert.equal(event.attempt_id, ATTEMPT_ID);
    assert.match(event.intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  }
  assert.notEqual(h.privateEvents[1].intent_fingerprint, h.privateEvents[2].intent_fingerprint);
  assert.deepEqual(h.childOptions.env, { SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1" });
  assert.deepEqual(h.childOptions.args, [resolve("dist/src/transports/stdio-owner.js")]);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.child_close_status, "CLOSED");
  assert.equal(result.mutation_calls.upload, 0);
  assert.equal(result.mutation_calls.generation, 0);
  assert.equal(result.mutation_calls.training, 0);
  assert.equal(result.mutation_calls.delete, 0);
  assert.deepEqual(h.calls.filter((name) => /upload|generate|train|delete/iu.test(name)), []);
  const text = JSON.stringify(result);
  for (const privateValue of [ATTEMPT_ID, HANDOFF_URI, h.secretOwnerId, h.secretName, h.secretUrl, h.rawMessage]) {
    assert.equal(text.includes(privateValue), false);
  }
  assert.deepEqual(Object.keys(result.reads[0].top_level.fields).sort(), ["items"]);
  assert.deepEqual(Object.keys(result.reads[0].items.fields).sort(), ["name", "style_id"]);
});

test("full fixed case uses 128-item cap and preserves a complete 78-item shape", async () => {
  const module = await load();
  const h = fakeHarness(module, { itemCount: 78 });
  const result = await module.runOwnerSoulShapeStdioAcceptance(configForCase(module, FULL_CASE_ID), h.io, h.dependencies);
  assert.equal(result.status, "PASS_SHAPE_DIAGNOSTIC_ONLY");
  assert.deepEqual(h.childOptions.env, {
    SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1", SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS: "128"
  });
  assert.deepEqual(result.reads.map(({ kind, sampling_limit, items }) =>
    ({ kind, sampling_limit, item_count: items.item_count, inspected_count: items.inspected_count, truncated: items.truncated })), [
    { kind: "styles", sampling_limit: 128, item_count: 78, inspected_count: 78, truncated: false },
    { kind: "characters", sampling_limit: 128, item_count: 78, inspected_count: 78, truncated: false }
  ]);
  const begin = h.privateEvents.find(({ event }) => event === "BEGIN");
  assert.equal(begin.case_id, FULL_CASE_ID);
  assert.equal(begin.sampling_limit, 128);
  assert.match(begin.intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  const intents = h.privateEvents.filter(({ event }) => event === "SOUL_SHAPE_INTENT");
  assert.ok(intents.every(({ sampling_limit }) => sampling_limit === 128));
  assert.ok(intents.every(({ case_id }) => case_id === FULL_CASE_ID));
  assert.notEqual(intents[0].intent_fingerprint, intents[1].intent_fingerprint);
});

test("full case reports truncation at the fixed 128-item sampling limit", async () => {
  const module = await load();
  const h = fakeHarness(module, { itemCount: 140 });
  const result = await module.runOwnerSoulShapeStdioAcceptance(configForCase(module, FULL_CASE_ID), h.io, h.dependencies);
  assert.equal(result.status, "PASS_SHAPE_DIAGNOSTIC_ONLY");
  assert.deepEqual(result.reads.map(({ items }) => ({ item_count: items.item_count,
    inspected_count: items.inspected_count, truncated: items.truncated })), [
    { item_count: 140, inspected_count: 128, truncated: true },
    { item_count: 140, inspected_count: 128, truncated: true }
  ]);
});

test("full output above the selected 128-item cap is rejected without reading the next kind", async () => {
  const module = await load();
  const h = fakeHarness(module, { outputMode: "over-cap" });
  const result = await module.runOwnerSoulShapeStdioAcceptance(configForCase(module, FULL_CASE_ID), h.io, h.dependencies);
  assert.equal(result.status, "SOUL_SHAPE_OUTPUT_INVALID");
  assert.equal(result.sampling_limit, 128);
  assert.deepEqual(h.shapeKinds, ["styles"]);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.child_close_status, "CLOSED");
});

test("legacy case retains the default 20-item cap and truncates larger lists", async () => {
  const module = await load();
  const h = fakeHarness(module, { itemCount: 78 });
  const result = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), h.io, h.dependencies);
  assert.equal(result.status, "PASS_SHAPE_DIAGNOSTIC_ONLY");
  assert.deepEqual(h.childOptions.env, { SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1" });
  assert.deepEqual(result.reads.map(({ sampling_limit, items }) =>
    ({ sampling_limit, item_count: items.item_count, inspected_count: items.inspected_count, truncated: items.truncated })), [
    { sampling_limit: 20, item_count: 78, inspected_count: 20, truncated: true },
    { sampling_limit: 20, item_count: 78, inspected_count: 20, truncated: true }
  ]);
});

test("no shape retry occurs after the first bounded read returns a safe tool error", async () => {
  const module = await load();
  const h = fakeHarness(module, { shapeErrorKind: "styles" });
  const result = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), h.io, h.dependencies);
  assert.equal(result.status, "SOUL_SHAPE_READ_FAILED");
  assert.equal(result.failure_code, "UPSTREAM_PROTOCOL_ERROR");
  assert.deepEqual(h.shapeKinds, ["styles"]);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.child_close_status, "CLOSED");
  assert.equal(JSON.stringify(result).includes(h.rawMessage), false);
});

test("malformed or value-bearing shape output is rejected and cleanup still runs", async () => {
  const module = await load();
  for (const outputMode of ["extra", "value", "unknown-key", "bad-type"]) {
    const h = fakeHarness(module, { outputMode });
    const result = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), h.io, h.dependencies);
    assert.equal(result.status, "SOUL_SHAPE_OUTPUT_INVALID", outputMode);
    assert.deepEqual(h.shapeKinds, ["styles"]);
    assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
    assert.equal(result.client_close_status, "CLOSED");
    assert.equal(result.child_close_status, "CLOSED");
    assert.equal(JSON.stringify(result).includes(h.secretName), false);
  }
});

test("BEGIN and per-kind acknowledgments must match the exact attempt and fresh fingerprint", async () => {
  const module = await load();
  for (const mismatch of ["begin-attempt", "begin-fingerprint", "read-attempt", "read-fingerprint"]) {
    const h = fakeHarness(module, { mismatch });
    const result = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), h.io, h.dependencies);
    assert.equal(result.status, mismatch.startsWith("begin") ? "BEGIN_NOT_CONFIRMED" : "SHAPE_READ_NOT_CONFIRMED");
    assert.equal(h.shapeKinds.length, 0);
    assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
    assert.equal(result.client_close_status, "CLOSED");
    assert.equal(result.child_close_status, "CLOSED");
  }
});

test("shape errors, malformed handoff and begin failures never leak raw data and always close", async () => {
  const module = await load();
  const invalidHandoff = fakeHarness(module, { invalidHandoff: true });
  const invalidResult = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), invalidHandoff.io, invalidHandoff.dependencies);
  assert.equal(invalidResult.status, "BEGIN_UNAVAILABLE");
  assert.equal(invalidHandoff.privateEvents.length, 0);
  assert.equal(invalidResult.client_close_status, "CLOSED");
  assert.equal(invalidResult.child_close_status, "CLOSED");

  const noBegin = fakeHarness(module, { beginError: true });
  const noBeginResult = await module.runOwnerSoulShapeStdioAcceptance(configFor(module), noBegin.io, noBegin.dependencies);
  assert.equal(noBeginResult.status, "BEGIN_UNAVAILABLE");
  assert.equal(noBegin.shapeKinds.length, 0);
  assert.equal(noBeginResult.client_close_status, "CLOSED");
  assert.equal(noBeginResult.child_close_status, "CLOSED");
  assert.equal(JSON.stringify(noBeginResult).includes(noBegin.rawMessage), false);
});

function configFor(module) {
  return configForCase(module, CASE_ID);
}

function configForCase(module, caseId) {
  return module.parseOwnerSoulShapeStdioAcceptanceArgs([
    "--confirm-owner-soul-shape-stdio-acceptance", "--real", "--case", caseId
  ]);
}

function fakeHarness(module, options = {}) {
  const calls = [], shapeKinds = [], shapeArguments = [], events = [], privateEvents = [], waiters = new Map();
  const secretOwnerId = "synthetic-owner-id-test-001";
  const secretName = "PRIVATE_SAMPLE_STYLE_NAME";
  const secretUrl = "https://r2.syntx.ai/private-soul-image.png";
  const rawMessage = "UNSAFE_RAW_PROVIDER_DIAGNOSTIC_291";
  let linked = true;
  let childOptionsLimit = 20;
  const tools = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", TOOL_NAME];
  const client = {
    async listTools() { events.push("list_tools"); return { tools: tools.map((name) => ({ name })) }; },
    async callTool({ name, arguments: args = {} }) {
      calls.push(name);
      if (name === "syntx_begin_login") {
        if (options.beginError) return toolError("UPSTREAM_UNAVAILABLE", rawMessage);
        return { structuredContent: { attempt_id: ATTEMPT_ID }, content: [{ type: "resource_link", uri: options.invalidHandoff ? "https://attacker.invalid/x" : HANDOFF_URI }] };
      }
      if (name === "syntx_check_login") return { structuredContent: {
        attempt_id: args.attempt_id, status: linked ? "LINKED" : "REVOKED", linked
      } };
      if (name === "syntx_unlink") { linked = false; return { structuredContent: { status: "REVOKED" } }; }
      if (name === TOOL_NAME) {
        shapeKinds.push(args.kind);
        shapeArguments.push({ ...args });
        if (options.shapeErrorKind === args.kind) return toolError("UPSTREAM_PROTOCOL_ERROR", rawMessage);
        return { structuredContent: shapeOutput(args.kind, options.outputMode, secretOwnerId, secretName, secretUrl,
          options.itemCount ?? 1, childOptionsLimit) };
      }
      throw new Error("UNEXPECTED_TOOL");
    },
    async close() { events.push("client_close"); }
  };
  const harness = {
    calls, shapeKinds, shapeArguments, events, privateEvents, secretOwnerId, secretName, secretUrl, rawMessage,
    childOptions: undefined,
    io: { stdout: { write(value) { events.push(`stdout:${value}`); } } },
    dependencies: {
      isSourceCheckout: () => true,
      createOwnerClient: async (childOptions) => {
        harness.childOptions = childOptions;
        childOptionsLimit = childOptions.env.SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS === "128" ? 128 : 20;
        events.push("client_open");
        return { client, async waitForExit() { events.push("child_exit"); return true; } };
      },
      sendPrivateIpc: async (message) => {
        privateEvents.push(message);
        const waiter = waiters.get(message.event);
        if (waiter) {
          waiters.delete(message.event);
          const wrongAttempt = options.mismatch === (message.event === "BEGIN" ? "begin-attempt" : "read-attempt");
          const wrongFingerprint = options.mismatch === (message.event === "BEGIN" ? "begin-fingerprint" : "read-fingerprint");
          waiter({ action: message.event === "BEGIN" ? "handoff_sent" : "approve_read",
            attempt_id: wrongAttempt ? `${ATTEMPT_ID}_foreign` : message.attempt_id,
            intent_fingerprint: wrongFingerprint ? `sha256:${"f".repeat(64)}` : message.intent_fingerprint,
            kind: message.kind });
        }
        return true;
      },
      waitForPrivateAction: (event) => new Promise((resolveAction) => { waiters.set(event, resolveAction); }),
      sleep: async () => {},
      now: () => 1_800_000_000_000
    }
  };
  return harness;
}

function shapeOutput(kind, mode, secretOwnerId, secretName, secretUrl, requestedItemCount = 1, samplingLimit = 20) {
  const itemCount = mode === "over-cap" ? samplingLimit + 1 : requestedItemCount;
  const inspectedCount = mode === "over-cap" ? samplingLimit + 1 : Math.min(itemCount, samplingLimit);
  const result = {
    model_id: "higgsfield-soul", catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    confidence_scope: "owner_authenticated_fixed_route_shape_only", generation_allowed: false, backend_acceptance: "unproven",
    kind, outcome: "SHAPE_OBSERVED", response_bytes: 128,
    top_level: { fields: { items: { types: ["array"], occurrences: 1 } }, unknown_key_count: 0 },
    items: { container_key: "items", item_count: itemCount, inspected_count: inspectedCount,
      truncated: itemCount > inspectedCount, value_types: ["object"],
      fields: kind === "styles"
        ? { style_id: { types: ["string"], occurrences: inspectedCount }, name: { types: ["string"], occurrences: inspectedCount } }
        : { id: { types: ["string"], occurrences: inspectedCount }, image: { types: ["string"], occurrences: inspectedCount } },
      unknown_key_count: 0 }
  };
  if (mode === "extra") result.raw_body = "must reject";
  if (mode === "value") result.items.fields[kind === "styles" ? "name" : "id"].value = secretName;
  if (mode === "unknown-key") result.items.fields[secretOwnerId] = { types: ["string"], occurrences: 1 };
  if (mode === "bad-type") result.items.container_key = secretUrl;
  return result;
}

function toolError(code, message) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] };
}
