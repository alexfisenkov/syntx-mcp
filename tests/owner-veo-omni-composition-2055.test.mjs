import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../dist/src/mcp/server.js";

test("Veo opt-in exposes Omni static parameters without granting generation or reading an account", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    throw new Error("This source-only composition must not request network access");
  };
  for (const enabled of [false, true]) {
    const runtime = createObservedOwnerRuntime({ ownerVeoT2vEnabled: enabled, fetchImpl });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "veo-omni-composition", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const matches = (await client.listTools()).tools.filter((item) => item.name === "syntx_get_veo_omni_parameters");
      assert.equal(matches.length, enabled ? 1 : 0);
      if (enabled) {
        const result = await client.callTool({ name: "syntx_get_veo_omni_parameters", arguments: {} });
        assert.notEqual(result.isError, true);
        assert.equal(result.structuredContent.model_id, "veo_omni");
        assert.equal(result.structuredContent.runtime_usable, false);
        assert.equal(result.structuredContent.dispatch_allowed, false);
        assert.equal(result.structuredContent.effective_defaults, "UNKNOWN");
      }
      assert.equal(requests, 0);
    } finally {
      await client.close();
      await server.close();
      await runtime.ownerVeoT2vLifecycle?.close();
      runtime.authStore.close?.();
    }
  }
});
