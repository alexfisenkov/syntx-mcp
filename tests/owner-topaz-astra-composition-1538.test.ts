import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { registerSyntxOwnerTopazAstraTools, OWNER_TOPAZ_ASTRA_TOOL_NAMES } from "../src/mcp/owner-topaz-astra-tools.js";
import { OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES } from "../src/mcp/owner-topaz-astra-existing-media-tools.js";

async function inventory(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<string[]> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "topaz-composition-1538-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    return (await client.listTools({})).tools.map((tool) => tool.name);
  } finally {
    await client.close(); await server.close();
    await clientTransport.close?.(); await serverTransport.close?.();
  }
}

test("createMcpServer accepts the known existing-media reader without leaking it into generation composition", async () => {
  let providerFetches = 0;
  const fetchImpl: typeof fetch = async () => { providerFetches++; throw new Error("no provider request is expected during composition"); };
  const disabled = createObservedOwnerRuntime({ fetchImpl });
  try {
    assert.equal(disabled.serverOptions.ownerTopazAstra, undefined);
    const defaultNames = await inventory(disabled);
    assert.equal(defaultNames.some((name) => OWNER_TOPAZ_ASTRA_TOOL_NAMES.includes(name as never) ||
      OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES.includes(name as never)), false);
  } finally { await disabled.authStore.close?.(); }

  const runtime = createObservedOwnerRuntime({ ownerTopazAstraEnabled: true, ownerTopazAstraFfprobePath: "/usr/bin/ffprobe",
    ownerTopazAstraUploadDestination: "hidden", fetchImpl });
  try {
    const composition = runtime.serverOptions.ownerTopazAstra;
    assert.ok(composition?.existingMediaService);
    const names = await inventory(runtime), topazNames = names.filter((name) => OWNER_TOPAZ_ASTRA_TOOL_NAMES.includes(name as never) ||
      OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES.includes(name as never));
    assert.equal(OWNER_TOPAZ_ASTRA_TOOL_NAMES.length, 6);
    assert.equal(OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES.length, 2);
    assert.equal(topazNames.length, 8);
    assert.deepEqual(new Set(topazNames), new Set([...OWNER_TOPAZ_ASTRA_TOOL_NAMES, ...OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES]));

    const rejectedServer = createMcpServer(runtime.application, { ...runtime.serverOptions, ownerTopazAstra: undefined });
    assert.throws(() => registerSyntxOwnerTopazAstraTools(rejectedServer, { ...composition, unexpected: true }),
      /TOPAZ_ASTRA_SERVICE_COMPOSITION_INVALID/u);
    assert.throws(() => registerSyntxOwnerTopazAstraTools(rejectedServer, { ...composition, existingMediaService: {} }),
      /TOPAZ_ASTRA_SERVICE_COMPOSITION_INVALID/u);
    await rejectedServer.close();
    assert.equal(providerFetches, 0);
  } finally {
    await runtime.ownerTopazAstraLifecycle?.close();
    await runtime.authStore.close?.();
  }
});
