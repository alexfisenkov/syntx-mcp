import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerClarityUpscaleFlag } from "../src/transports/stdio-owner.js";
import {
  SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME
} from "../src/mcp/owner-clarity-upscale-tools.js";

const CLARITY_TOOL_NAMES = [
  SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME
];

async function listedNames(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<string[]> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "clarity-owner-composition-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools.map((tool) => tool.name); }
  finally { await client.close(); await server.close(); }
}

test("default runtime does not construct or register Clarity owner tools and does no fetch", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => { fetchCalls += 1; throw new Error("unexpected network"); } });
  assert.equal(runtime.serverOptions.ownerClarityUpscale, undefined);
  const names = await listedNames(runtime);
  assert.equal(names.some((name) => CLARITY_TOOL_NAMES.includes(name as typeof CLARITY_TOOL_NAMES[number])), false);
  assert.equal(fetchCalls, 0);
});

test("explicit owner-local Clarity composition registers exactly four tools without preflight at startup", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({
    ownerClarityUpscaleEnabled: true,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("startup must not contact SYNTX"); }
  });
  assert.ok(runtime.serverOptions.ownerClarityUpscale);
  const names = await listedNames(runtime);
  assert.deepEqual(names.filter((name) => CLARITY_TOOL_NAMES.includes(name as typeof CLARITY_TOOL_NAMES[number])).sort(), [...CLARITY_TOOL_NAMES].sort());
  assert.equal(fetchCalls, 0);
  await runtime.serverOptions.ownerClarityUpscale.generationService.close();
});

test("Clarity composition is incompatible with the existing durable-generation mode", () => {
  const runtime = createObservedOwnerRuntime({ ownerClarityUpscaleEnabled: true });
  assert.throws(() => createMcpServer(runtime.application, {
    ownerClarityUpscale: runtime.serverOptions.ownerClarityUpscale,
    ownerDurableGeneration: {} as NonNullable<typeof runtime.serverOptions.ownerDurableGeneration>
  }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
  void runtime.serverOptions.ownerClarityUpscale?.generationService.close();
});

test("Clarity owner stdio flag is exact and default-off", () => {
  assert.equal(readOwnerClarityUpscaleFlag(undefined), false);
  assert.equal(readOwnerClarityUpscaleFlag(""), false);
  assert.equal(readOwnerClarityUpscaleFlag("0"), false);
  assert.equal(readOwnerClarityUpscaleFlag("1"), true);
  for (const value of ["true", "yes", "01", " 1 ", "2"]) {
    assert.throws(() => readOwnerClarityUpscaleFlag(value), /Invalid SYNTX_OWNER_CLARITY_UPSCALE configuration/u);
  }
});

test("owner stdio closes Clarity generation and its upload child once before auth profile cleanup", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined, async close() {} } as unknown as Transport;
  const close = closeOwnerReadServicesOnTransportEof(
    transport,
    undefined,
    undefined,
    undefined,
    undefined,
    () => { events.push("auth-profile.close"); },
    input,
    { async close() { events.push("generation.close"); events.push("upload.close"); } }
  );
  await close();
  await close();
  assert.deepEqual(events, ["generation.close", "upload.close", "auth-profile.close"]);
  input.destroy();
});
