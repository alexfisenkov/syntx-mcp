import test from "node:test";
import assert from "node:assert/strict";
import { verifyLoopbackHealth } from "./private-owner-install.mjs";

const plan = { config: { port: 8860, basePath: "/syntx-ai" }, publicOrigin: "https://mcp.fisenkov.ru" };
const expectedMetadata = "https://mcp.fisenkov.ru/.well-known/oauth-protected-resource/syntx-ai/mcp";

function clock() {
  let elapsed = 0;
  const timeouts = [];
  return { now: () => elapsed, sleep: async (ms) => { assert.ok(ms > 0 && ms <= 200); elapsed += ms; },
    timeoutSignal: (ms) => { assert.ok(ms > 0 && ms <= 1000); timeouts.push(ms); return new AbortController().signal; },
    elapsed: () => elapsed, timeouts };
}

test("fast connection refusal remains eligible after 30 polls and succeeds once eager warm is ready", async () => {
  const c = clock(); let healthCalls = 0, protectedCalls = 0;
  await verifyLoopbackHealth(plan, { ...c, fetch: async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith("/health")) {
      healthCalls++;
      if (c.elapsed() < 7200) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      return { status: 200, json: async () => ({ surface: "private-owner", status: "ok" }) };
    }
    assert.equal(url, "http://127.0.0.1:8860/syntx-ai/mcp");
    assert.equal(options.method, "POST"); protectedCalls++;
    return { status: 401, headers: { get: () => `Bearer resource_metadata="${expectedMetadata}"` } };
  } });
  assert.ok(healthCalls > 30); assert.equal(protectedCalls, 1);
  assert.equal(c.elapsed(), 7200); assert.ok(c.timeouts.every((ms) => ms <= 1000));
});

test("unready loopback fails at the elapsed deadline even when every refusal is immediate", async () => {
  const c = clock(); let attempts = 0;
  await assert.rejects(verifyLoopbackHealth(plan, { ...c, fetch: async () => {
    attempts++; throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
  } }), /DEPLOY_LOOPBACK_HEALTH_OR_AUTH_FAILED/u);
  assert.equal(c.elapsed(), 45_000);
  assert.ok(attempts > 30); assert.ok(attempts <= 226);
  assert.ok(c.timeouts.every((ms) => ms > 0 && ms <= 1000));
});

test("health and exact unauthenticated Bearer metadata challenge both remain required", async () => {
  const c = clock(); let healthCalls = 0, protectedCalls = 0;
  await verifyLoopbackHealth(plan, { ...c, fetch: async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith("/health")) {
      healthCalls++;
      return { status: 200, json: async () => ({ surface: "private-owner", status: healthCalls === 1 ? "starting" : "ok" }) };
    }
    assert.equal(options.method, "POST"); protectedCalls++;
    return { status: 401, headers: { get: () => protectedCalls === 1 ? "Bearer invalid" : `Bearer resource_metadata="${expectedMetadata}"` } };
  } });
  assert.equal(healthCalls, 3); assert.equal(protectedCalls, 2); assert.equal(c.elapsed(), 400);
});
