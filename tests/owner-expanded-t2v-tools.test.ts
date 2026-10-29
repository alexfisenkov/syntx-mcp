import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOwnerExpandedT2vProfiles, type OwnerExpandedT2vModelId } from "../src/application/owner-expanded-t2v-profile.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME,
  SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME,
  registerSyntxOwnerExpandedT2vTools
} from "../src/mcp/owner-expanded-t2v-tools.js";
import { isReviewedMediaFlagEnabled } from "../src/runtime/reviewed-media-profile.js";

test("expanded T2V MCP tool schemas expose reviewed controls and route GET recovery without generation", async () => {
  const profiles = createOwnerExpandedT2vProfiles(resolve(process.cwd(), "catalog"));
  const source = profiles.get("happy_horse_t2v")!.source;
  let generationCalls = 0;
  let reconcileCalls = 0;
  let listCalls = 0;
  const server = new McpServer({ name: "expanded-t2v-tools-test", version: "1.0.0" });
  registerSyntxOwnerExpandedT2vTools(server, { service: {
    getParametersSource: (modelId: OwnerExpandedT2vModelId) => profiles.get(modelId)!.source,
    async generate() { generationCalls += 1; return {} as never; },
    async reconcile() { reconcileCalls += 1; return {} as never; },
    listRecoveries() { listCalls += 1; return []; }
  } as never });
  const client = new Client({ name: "expanded-t2v-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), [
      SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME,
      SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME,
      SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME
    ].sort());
    const generateTool = listedTools.tools.find((tool) => tool.name === SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME)!;
    const schema = generateTool.inputSchema as { properties?: Record<string, { enum?: unknown[] }>; required?: string[]; additionalProperties?: boolean };
    assert.deepEqual(schema.properties?.model_id?.enum?.slice().sort(), ["flux3_t2v", "happy_horse_t2v", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "text2video-4.5"].sort());
    assert.deepEqual(schema.properties?.resolution?.enum?.slice().sort(), ["hd", "fhd", "720P", "1080P", "720p", "480p", "1080p"].sort());
    assert.deepEqual(schema.properties?.aspect_ratio?.enum?.slice().sort(), ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16", "169", "916"].sort());
    assert.deepEqual(schema.required?.sort(), ["link_attempt_id", "model_id", "prompt"]);
    assert.equal(schema.additionalProperties, false);
    const parameters = await client.callTool({ name: SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME, arguments: { model_id: "happy_horse_t2v" } });
    assert.deepEqual((parameters.structuredContent as { controls: unknown }).controls, source.controls);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME, arguments: {
      model_id: "happy_horse_t2v", link_attempt_id: "link_expanded_t2v_sdk_test_0123456789"
    } });
    assert.equal(listed.isError, undefined);
    assert.equal(listCalls, 1);
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME, arguments: {
      model_id: "happy_horse_t2v", link_attempt_id: "link_expanded_t2v_sdk_test_0123456789",
      recovery_id: "recovery_00000000-0000-4000-8000-000000000000"
    } });
    assert.equal(reconciled.isError, true);
    assert.equal(reconcileCalls, 1);
    const invalid = await client.callTool({ name: SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME, arguments: {
      model_id: "happy_horse_t2v", link_attempt_id: "link_expanded_t2v_sdk_test_0123456789", prompt: "invalid resolution",
      video_duration: 16, resolution: "720P", aspect_ratio: "16:9"
    } });
    assert.equal(invalid.isError, true);
    assert.equal(generationCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("all-supported profile includes expanded T2V while explicit group overrides retain precedence", () => {
  const env = { SYNTX_OWNER_MEDIA_PROFILE: "all-supported" };
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_EXPANDED_T2V", undefined, env), true);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_EXPANDED_T2V", "0", env), false);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_EXPANDED_T2V", "1", { SYNTX_OWNER_MEDIA_PROFILE: "default" }), true);
});

test("expanded T2V owner composition starts only when the trusted owner flag is enabled", async () => {
  const fetchImpl: typeof fetch = async () => { throw new Error("Unexpected startup network request"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(Reflect.get(defaults.serverOptions, "ownerExpandedT2v"), undefined);
  const enabled = createObservedOwnerRuntime({ ownerExpandedT2vEnabled: true, fetchImpl });
  try { assert.ok(Reflect.get(enabled.serverOptions, "ownerExpandedT2v")); }
  finally {
    const lifecycle = Reflect.get(enabled, "ownerExpandedT2vLifecycle") as { close?: () => Promise<void> } | undefined;
    await lifecycle?.close?.();
  }
});
