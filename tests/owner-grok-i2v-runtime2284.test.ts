import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  readOwnerGrokI2vFlag,
  readOwnerGrokI2vOperatorConfiguration
} from "../src/runtime/owner-grok-i2v-stdio-config.js";
import { OWNER_GROK_I2V_TOOL_NAMES } from "../src/mcp/owner-grok-i2v-tools.js";

test("2284 Grok I2V operator flag is independent and defaults off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerGrokI2vFlag(value), false);
  assert.equal(readOwnerGrokI2vFlag("1"), true);
  for (const value of [true, "true", "yes", "2"]) assert.throws(() => readOwnerGrokI2vFlag(value));
});

test("2284 upload destination is required only for enabled owner I2V", () => {
  assert.equal(readOwnerGrokI2vOperatorConfiguration(false, undefined), undefined);
  assert.equal(readOwnerGrokI2vOperatorConfiguration(false, "invalid"), undefined);
  assert.deepEqual(readOwnerGrokI2vOperatorConfiguration(true, "uploaded"), { uploadDestination: "uploaded" });
  assert.deepEqual(readOwnerGrokI2vOperatorConfiguration(true, "hidden"), { uploadDestination: "hidden" });
  for (const value of [undefined, "", "other", true]) assert.throws(() => readOwnerGrokI2vOperatorConfiguration(true, value));
});

test("2284 observed runtime omits Grok I2V by default and registers four tools only after independent opt-in", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
  const attempt = "link_grok_i2v_runtime_0123456789abcdef";
  for (const enabled of [false, true]) {
    const runtime = createObservedOwnerRuntime({ ownerGrokI2vEnabled: enabled,
      ...(enabled ? { ownerGrokI2vUploadDestination: "uploaded" as const } : {}),
      catalogDirectory: resolve("catalog"), fetchImpl });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "grok-i2v-runtime-2284", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.deepEqual(names.filter((name) => (OWNER_GROK_I2V_TOOL_NAMES as readonly string[]).includes(name)),
        enabled ? OWNER_GROK_I2V_TOOL_NAMES : []);
      assert.equal(runtime.serverOptions.ownerGrokI2v !== undefined, enabled);
      assert.equal(typeof runtime.ownerGrokI2vLifecycle?.invalidateAttempt, enabled ? "function" : "undefined");
      assert.equal(networkCalls, 0);
      if (enabled) await runtime.ownerGrokI2vLifecycle!.invalidateAttempt(attempt);
    } finally {
      await runtime.ownerGrokI2vLifecycle?.close();
      await Promise.allSettled([client.close(), server.close()]);
      runtime.authStore.close?.();
    }
  }
});

test("2284 enabled Grok I2V startup requires an explicit upload destination", () => {
  assert.throws(() => createObservedOwnerRuntime({ ownerGrokI2vEnabled: true }), /OWNER_GROK_I2V_UPLOAD_DESTINATION_REQUIRED/u);
});
