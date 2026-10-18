import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_SEEDANCE_EDITOR_TOOL_NAMES } from "../src/mcp/owner-seedance-editor-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  readOwnerSeedanceEditorFlag,
  readOwnerSeedanceEditorOperatorConfiguration
} from "../src/runtime/owner-seedance-editor-stdio-config.js";

test("Seedance Editor flag is strict and remains disabled unless exactly opted in", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerSeedanceEditorFlag(value), false);
  assert.equal(readOwnerSeedanceEditorFlag("1"), true);
  for (const value of [true, false, "true", "01", " 1", 1, null]) {
    assert.throws(() => readOwnerSeedanceEditorFlag(value), /Invalid SYNTX_OWNER_SEEDANCE_EDITOR configuration/u);
  }
});

test("Seedance Editor operator config requires an absolute ffprobe path and bounds the local cap", () => {
  assert.equal(readOwnerSeedanceEditorOperatorConfiguration(false, "relative/ffprobe", "0"), undefined);
  assert.deepEqual(readOwnerSeedanceEditorOperatorConfiguration(true, process.execPath, undefined), {
    ffprobePath: process.execPath, maxVideoFileBytes: 64 * 1024 * 1024
  });
  assert.deepEqual(readOwnerSeedanceEditorOperatorConfiguration(true, process.execPath, "1048576"), {
    ffprobePath: process.execPath, maxVideoFileBytes: 1024 * 1024
  });
  for (const [path, cap] of [
    [undefined, undefined], ["relative/ffprobe", undefined], [`${process.execPath}/../node`, undefined],
    [process.execPath, "0"], [process.execPath, "-1"], [process.execPath, "1.5"],
    [process.execPath, "010"], [process.execPath, "104857601"], [process.execPath, "9999999999"]
  ] as const) {
    assert.throws(() => readOwnerSeedanceEditorOperatorConfiguration(true, path, cap),
      /Invalid SYNTX_OWNER_SEEDANCE_EDITOR operator configuration/u);
  }
});

test("observed owner runtime registers only the opt-in Editor tools and forwards its local cap", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected network call during local Editor tool registration");
  };
  for (const enabled of [false, true]) {
    const runtime = createObservedOwnerRuntime({ ownerSeedanceEditorEnabled: enabled,
      ownerSeedanceEditorFfprobePath: process.execPath, ownerSeedanceEditorMaxVideoFileBytes: 1024,
      catalogDirectory: resolve("catalog"), fetchImpl });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "seedance-editor-config2232", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const names = (await client.listTools()).tools.map(row => row.name);
      assert.deepEqual(names.filter(name => (OWNER_SEEDANCE_EDITOR_TOOL_NAMES as readonly string[]).includes(name)),
        enabled ? OWNER_SEEDANCE_EDITOR_TOOL_NAMES : []);
      if (enabled) assert.equal(runtime.serverOptions.ownerSeedanceEditor?.maxVideoFileBytes, 1024);
      else assert.equal(runtime.serverOptions.ownerSeedanceEditor, undefined);
      assert.equal(fetchCalls, 0, "tool registration and listing make no upstream calls");
    } finally {
      await runtime.ownerSeedanceEditorLifecycle?.close();
      await Promise.allSettled([client.close(), server.close()]);
      runtime.authStore.close?.();
    }
  }
});
