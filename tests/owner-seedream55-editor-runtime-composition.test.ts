import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OWNER_SEEDREAM55_EDITOR_TOOL_NAMES } from "../src/mcp/owner-seedream55-editor-tools.js";

test("Editor 5.5 is default-off, isolated from legacy and closed by the existing opt-in lifecycle", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => { networkCalls++; throw new Error("Unexpected network during composition"); };
  const plain = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(plain.serverOptions.ownerSeedream55EditorImageReferences, undefined);
  const enabled = createObservedOwnerRuntime({ fetchImpl, ownerSeedreamEditorImageReferencesEnabled: true });
  assert.ok(enabled.serverOptions.ownerSeedreamEditorImageReferences);
  assert.ok(enabled.serverOptions.ownerSeedream55EditorImageReferences);
  assert.notEqual(enabled.serverOptions.ownerSeedreamEditorImageReferences.generationService,
    enabled.serverOptions.ownerSeedream55EditorImageReferences.service);
  const server = createMcpServer(enabled.application, enabled.serverOptions);
  const caller = new Client({ name: "editor55-runtime-composition", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await caller.connect(clientTransport);
  try {
    const tools = (await caller.listTools()).tools;
    for (const name of OWNER_SEEDREAM55_EDITOR_TOOL_NAMES) assert.equal(tools.filter(t => t.name === name).length, 1, name);
    const current = await caller.callTool({ name: "syntx_get_seedream55_editor_parameters", arguments: {} });
    assert.notEqual(current.isError, true);
    const currentData = current.structuredContent as Record<string, unknown>;
    assert.equal(currentData.variant, "seedream-5.5");
    assert.equal(currentData.public_catalog_version,
      "sha256-49f41bb1565932456137e2a264a2904c441a95e9f5e0aa2a76a9a0c503fedc13.json");
    const legacy = await caller.callTool({ name: "syntx_get_seedream_editor_image_parameters", arguments: {} });
    assert.notEqual(legacy.isError, true);
    const variants = (legacy.structuredContent as Record<string, unknown>).variants as { variant: string }[];
    assert.equal(variants.length, 5);
    assert.equal(variants.some(v => v.variant === "seedream-5.5"), false);
    assert.equal(networkCalls, 0);
  } finally {
    await caller.close(); await server.close();
    await enabled.ownerSeedreamEditorImageReferencesLifecycle?.close();
  }
  await assert.rejects(enabled.serverOptions.ownerSeedream55EditorImageReferences.service.listRecoveries({
    attemptId: "link_editor55_closed_attempt_12345", limit: 20
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_CLOSED");
  assert.equal(networkCalls, 0);
});
