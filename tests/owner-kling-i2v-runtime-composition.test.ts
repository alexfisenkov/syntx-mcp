import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OWNER_KLING_I2V_SOURCE_PINS } from "../src/application/owner-kling-i2v-parameters.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("Kling I2V uses its pinned B066 catalog and drains both owner services before auth release", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("Unexpected network request in composition test");
  };
  const runtime = createObservedOwnerRuntime({
    ownerKlingI2vEnabled: true,
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    fetchImpl
  });
  const composition = runtime.serverOptions.ownerKlingI2v;
  assert.ok(composition);
  assert.equal(runtime.serverOptions.ownerKlingT2v, undefined);
  assert.deepEqual(composition.generationService.getParametersSource().source_pins,
    OWNER_KLING_I2V_SOURCE_PINS);

  const events: string[] = [];
  const input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const closeLifecycle = {
    async close() {
      events.push("kling.i2v.close");
      await runtime.ownerKlingI2vLifecycle?.close();
    }
  };
  const args: unknown[] = new Array(39).fill(undefined);
  args[0] = transport;
  args[5] = () => { events.push("auth.close"); };
  args[6] = input;
  args[38] = closeLifecycle;
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["kling.i2v.close", "auth.close"]);
    assert.throws(() => composition.generationService.list({ attemptId: "link_kling_i2v_runtime_00000001" }),
      { code: "SERVICE_CLOSED" });
    await assert.rejects(composition.referenceService.upload({}), { code: "SERVICE_CLOSED" });
    assert.equal(networkCalls, 0);
  } finally {
    await runtime.ownerKlingI2vLifecycle?.close();
    input.destroy();
    runtime.authStore.close?.();
  }
});

test("Kling I2V runtime is absent unless explicitly enabled", () => {
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("No network expected"); } });
  try {
    assert.equal(runtime.serverOptions.ownerKlingI2v, undefined);
  } finally {
    runtime.authStore.close?.();
  }
});

test("Kling I2V stdio flag accepts only exact opt-in and conflicts with durable mode", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_KLING_I2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_KLING_I2V configuration/u);
    process.env.SYNTX_OWNER_KLING_I2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    Object.assign(process.env, saved);
  }
});
