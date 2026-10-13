import assert from "node:assert/strict";
import test from "node:test";
import { SyntxHttpClient, SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = ["account", "test", "credential", "not", "real"].join("-");
const broker: SyntxCredentialBroker = { async useCredential(operation) { return operation(SECRET); } };
const reads = ["getAccountBalance", "getSubscription"] as const;
function json(raw: unknown, status = 200): Response {
  return new Response(JSON.stringify(raw), { status, headers: { "content-type": "application/json" } });
}
function hasCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof SyntxHttpError);
    assert.equal(error.code, code);
    assert.equal(String(error).includes(SECRET), false);
    return true;
  };
}

test("account GET routes are fixed, credential-scoped and strip private fields", async () => {
  const urls: string[] = [];
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    urls.push(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
    return json(String(input).includes("balance")
      ? { balance: "0000.000", private_field: SECRET }
      : { active: false, type: "basic", end_date: "2026-09-04", private_field: SECRET });
  } });
  assert.deepEqual(await client.getAccountBalance(), { available: "0000.000" });
  const plan = await client.getSubscription();
  assert.deepEqual(plan, { active: false, plan_type: "basic", end_date: "2026-09-04", end_date_kind: "DATE_ONLY" });
  assert.deepEqual(urls, ["https://api.syntx.ai/api/v1/user/balance", "https://api.syntx.ai/api/v1/user/subscription?ref=false"]);
});

test("HTTP balance retains original decimal number tokens instead of rounded JS numbers", async () => {
  for (const token of ["0", "-0", "1.25", "9007199254740990.1", "900719925474099123456789", "0.00000000000000001"]) {
    const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () =>
      new Response(`{"balance":${token}}`, { headers: { "content-type": "application/json" } })
    });
    assert.deepEqual(await client.getAccountBalance(), { available: token });
  }
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => json({ balance: "+0001.2500" }) });
  assert.deepEqual(await client.getAccountBalance(), { available: "+0001.2500" });
});

test("HTTP balance rejects exponent underflow and unbounded tokens without false zero", async () => {
  for (const token of ["1e-324", "-1e-324", "0e0", "1e3", "1e309", "9".repeat(129)]) {
    const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () =>
      new Response(`{"balance":${token}}`, { headers: { "content-type": "application/json" } })
    });
    await assert.rejects(client.getAccountBalance(), hasCode("UPSTREAM_PROTOCOL_ERROR"));
  }
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () =>
    new Response('{"balance":1.25,"ignored":{"":{"balance":1e-324}}}', { headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(await client.getAccountBalance(), { available: "1.25" });
});

test("HTTP numeric balance fails closed if native reviver source is unavailable", async (context) => {
  const nativeParse = JSON.parse;
  context.mock.method(JSON, "parse", (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown => {
    return nativeParse(text, reviver ? function (this: unknown, key: string, value: unknown): unknown {
      return reviver.call(this, key, value);
    } : undefined) as unknown;
  });
  const numeric = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () =>
    new Response('{"balance":1.25}', { headers: { "content-type": "application/json" } })
  });
  await assert.rejects(numeric.getAccountBalance(), hasCode("UPSTREAM_PROTOCOL_ERROR"));
  const string = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () =>
    new Response('{"balance":"1.25"}', { headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(await string.getAccountBalance(), { available: "1.25" });
});

test("account reads normalize upstream failures and do not retry", async () => {
  for (const read of reads) {
    for (const [status, code] of [
      [401, "AUTH_OR_ACCESS_DENIED"], [403, "AUTH_OR_ACCESS_DENIED"],
      [429, "UPSTREAM_RATE_LIMITED"], [500, "UPSTREAM_UNAVAILABLE"], [504, "UPSTREAM_TIMEOUT"]
    ] as const) {
      let calls = 0;
      const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => {
        calls += 1;
        return json({ private_error: SECRET }, status);
      } });
      await assert.rejects(client[read](), hasCode(code));
      assert.equal(calls, 1);
    }
  }
});

test("account reads reject malformed, oversized, redirected and non-UTF8 bodies", async () => {
  const cases = [
    () => new Response("not JSON", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "257" } }),
    () => json({ ignored: "x".repeat(300) }),
    () => new Response(new Uint8Array([123, 255, 125]), { headers: { "content-type": "application/json" } }),
    () => { const response = json({}); Object.defineProperty(response, "redirected", { value: true }); return response; },
    () => { const response = json({}); Object.defineProperty(response, "url", { value: "https://invalid.example" }); return response; },
    () => json({ balance: { private: SECRET }, active: "false" })
  ];
  for (const read of reads) {
    for (const response of cases) {
      const client = new SyntxHttpClient({ credentialBroker: broker, maxResponseBytes: 256, fetchImpl: async () => response() });
      await assert.rejects(client[read](), hasCode("UPSTREAM_PROTOCOL_ERROR"));
    }
  }
});

test("account caller abort occurs before credential lookup or network", async () => {
  let credentials = 0;
  let fetches = 0;
  const controller = new AbortController();
  controller.abort();
  const client = new SyntxHttpClient({
    credentialBroker: { async useCredential(operation) { credentials += 1; return operation(SECRET); } },
    fetchImpl: async () => { fetches += 1; return json({}); }
  });
  for (const read of reads) await assert.rejects(client[read](controller.signal), hasCode("UPSTREAM_REQUEST_ABORTED"));
  assert.equal(credentials, 0);
  assert.equal(fetches, 0);
});

test("account deadlines bound stalled fetch and credential lookup; network errors are redacted", async () => {
  for (const read of reads) {
    const client = new SyntxHttpClient({ credentialBroker: broker, requestTimeoutMs: 5, fetchImpl: async () => new Promise<Response>(() => undefined) });
    await assert.rejects(client[read](), hasCode("UPSTREAM_TIMEOUT"));
    const stalled = new SyntxHttpClient({ credentialBroker: { async useCredential<T>() { return new Promise<T>(() => undefined); } }, requestTimeoutMs: 5 });
    await assert.rejects(stalled[read](), hasCode("UPSTREAM_TIMEOUT"));
    const network = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => { throw new Error(SECRET); } });
    await assert.rejects(network[read](), hasCode("UPSTREAM_UNAVAILABLE"));
  }
});
