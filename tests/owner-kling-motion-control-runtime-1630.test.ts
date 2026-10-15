import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import test from "node:test";
import { OWNER_KLING_MOTION_CONTROL_TOOL_NAMES } from "../src/mcp/owner-kling-motion-control-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerKlingMotionControlFlag } from "../src/transports/stdio-owner.js";

async function withSdk(runtime: ReturnType<typeof createObservedOwnerRuntime>, run: (client: Client) => Promise<void>): Promise<void> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "motion-control-runtime-1630", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); }
  finally { await Promise.all([client.close(), server.close(), runtime.ownerKlingMotionControlLifecycle?.close()]); }
}

test("Kling Motion Control stays default-off and exposes the strict nine-tool surface only on explicit owner opt-in", async () => {
  assert.equal(readOwnerKlingMotionControlFlag(undefined), false);
  assert.equal(readOwnerKlingMotionControlFlag(""), false);
  assert.equal(readOwnerKlingMotionControlFlag("0"), false);
  assert.equal(readOwnerKlingMotionControlFlag("1"), true);
  for (const value of ["true", "01", " 1", "1 ", "2"]) assert.throws(() => readOwnerKlingMotionControlFlag(value));

  const unexpectedFetch = async () => { throw new Error("unexpected startup HTTP"); };
  const catalogDirectory = resolve(process.cwd(), "catalog");
  assert.throws(() => createObservedOwnerRuntime({ ownerKlingMotionControlEnabled: true, catalogDirectory, fetchImpl: unexpectedFetch }),
    /OWNER_KLING_MOTION_CONTROL_OPERATOR_CONFIGURATION_REQUIRED/u);

  const defaultRuntime = createObservedOwnerRuntime({ catalogDirectory, fetchImpl: unexpectedFetch });
  await withSdk(defaultRuntime, async (client) => {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => OWNER_KLING_MOTION_CONTROL_TOOL_NAMES.includes(name as typeof OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[number])), false);
  });

  const runtime = createObservedOwnerRuntime({ catalogDirectory, ownerKlingMotionControlEnabled: true, ownerKlingMotionControlFfprobePath: "/usr/bin/ffprobe",
    fetchImpl: unexpectedFetch });
  const composition = runtime.serverOptions.ownerKlingMotionControl;
  assert.ok(composition);
  assert.ok(runtime.ownerKlingMotionControlLifecycle);
  await withSdk(runtime, async (client) => {
    const listed = (await client.listTools()).tools;
    const actualNames = listed.map(({ name }) => name).filter((name) => OWNER_KLING_MOTION_CONTROL_TOOL_NAMES.includes(name as typeof OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[number]));
    assert.deepEqual(actualNames, OWNER_KLING_MOTION_CONTROL_TOOL_NAMES);
    for (const name of OWNER_KLING_MOTION_CONTROL_TOOL_NAMES) {
      const tool = listed.find((candidate) => candidate.name === name);
      assert.ok(tool, `${name} is registered by the opted-in runtime`);
      assert.equal((tool.inputSchema as { type?: string }).type, "object");
      assert.equal((tool.inputSchema as { additionalProperties?: boolean }).additionalProperties ?? false, false);
      assert.ok(tool.outputSchema, `${name} exposes its declared output schema`);
      if (new Set<string>([OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[0], OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[1], OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[2],
        OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[3], OWNER_KLING_MOTION_CONTROL_TOOL_NAMES[4]]).has(name)) {
        const outputProperties = (tool.outputSchema as { properties?: Record<string, { enum?: unknown[] }> }).properties;
        assert.ok(outputProperties?.status?.enum?.includes("unavailable"), `${name} advertises its typed unavailable result`);
      }
    }

    const generate = listed.find(({ name }) => name === "syntx_owner_generate_kling_motion_control_video");
    assert.ok(generate);
    const input = generate.inputSchema as { properties: Record<string, unknown>; required: string[]; anyOf?: unknown; oneOf?: unknown };
    assert.deepEqual(Object.keys(input.properties).sort(), ["link_attempt_id", "model_id", "image_handle", "reference_source", "video_handle",
      "preset_video_handle", "version", "mode", "gen_type", "native_audio", "video_duration", "prompt"].sort());
    assert.equal(input.anyOf, undefined);
    assert.equal(input.oneOf, undefined);
    assert.equal(input.properties.url, undefined);
    assert.equal(input.properties.uri, undefined);
    assert.equal(input.required.includes("reference_source"), true);
    assert.equal(input.required.includes("video_handle"), false);
    assert.equal(input.required.includes("preset_video_handle"), false);
    assert.equal(generate.annotations?.readOnlyHint, false);
    assert.equal(generate.annotations?.destructiveHint, true);
    assert.equal(generate.annotations?.idempotentHint, false);
  });
});
