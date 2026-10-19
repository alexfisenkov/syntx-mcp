import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_RUNWAY_I2V_TOOL_NAMES } from "../src/mcp/owner-runway-i2v-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerRunwayI2vFlag } from "../src/runtime/owner-runway-i2v-stdio-config.js";

const ATTEMPT = "link_runway_runtime_2262_0123456789abcdef";

test("Runway I2V flag is independent and strict default-off opt-in", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerRunwayI2vFlag(value), false);
  assert.equal(readOwnerRunwayI2vFlag("1"), true);
  for (const value of [true, false, "true", "01", " 1", 1, null]) {
    assert.throws(() => readOwnerRunwayI2vFlag(value), /Invalid SYNTX_OWNER_RUNWAY_I2V configuration/u);
  }
});

test("observed runtime omits Runway I2V by default and registers its four tools only when enabled", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected network call during tool listing"); };
  for (const enabled of [false, true]) {
    const runtime = createObservedOwnerRuntime({ ownerRunwayI2vEnabled: enabled, catalogDirectory: resolve("catalog"), fetchImpl });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "runway-i2v-runtime-2262", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const names = (await client.listTools()).tools.map(row => row.name);
      assert.deepEqual(names.filter(name => (OWNER_RUNWAY_I2V_TOOL_NAMES as readonly string[]).includes(name)),
        enabled ? OWNER_RUNWAY_I2V_TOOL_NAMES : []);
      assert.equal(runtime.serverOptions.ownerRunwayI2v !== undefined, enabled);
      assert.equal(typeof runtime.ownerRunwayI2vLifecycle?.invalidateAttempt, enabled ? "function" : "undefined");
      assert.equal(fetchCalls, 0, "composition and tool registration do not call upstream services");
      if (enabled) await runtime.ownerRunwayI2vLifecycle!.invalidateAttempt(ATTEMPT);
    } finally {
      await runtime.ownerRunwayI2vLifecycle?.close();
      await Promise.allSettled([client.close(), server.close()]);
      runtime.authStore.close?.();
    }
  }
});
