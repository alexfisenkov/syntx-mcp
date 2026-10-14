import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OWNER_HAILUO02_I2V_SOURCE_PINS } from "../src/application/owner-hailuo02-i2v-source-profile.js";
import { OwnerHailuo02I2vGenerationService } from "../src/application/owner-hailuo02-i2v-generation-service.js";
import { OWNER_HAILUO02_I2V_GENERATION_CATALOG_VERSION } from "../src/application/owner-hailuo02-i2v-generation-service.js";
import { OwnerHailuo02I2vImageReferenceService } from "../src/application/owner-hailuo02-i2v-image-reference-service.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerHailuo02I2vFlag } from "../src/runtime/owner-hailuo02-i2v-stdio-config.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("Hailuo-02 I2V flag is strict and default-off before auth or network startup", async () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHailuo02I2vFlag(value), false);
  assert.equal(readOwnerHailuo02I2vFlag("1"), true);
  for (const value of ["true", "01", " 1", "2"]) {
    assert.throws(() => readOwnerHailuo02I2vFlag(value), /Invalid SYNTX_OWNER_HAILUO02_I2V configuration/u);
  }
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    process.env.SYNTX_OWNER_HAILUO02_I2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_HAILUO02_I2V configuration/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("Hailuo-02 I2V runtime composes genuine owner services on its pinned catalog and drains on EOF", async () => {
  let networkCalls = 0;
  const runtime = createObservedOwnerRuntime({
    ownerHailuo02I2vEnabled: true,
    fetchImpl: async () => { networkCalls += 1; throw new Error("Unexpected runtime network request"); }
  });
  const composition = runtime.serverOptions.ownerHailuo02I2v;
  assert.ok(composition);
  assert.ok(composition.imageReferenceService instanceof OwnerHailuo02I2vImageReferenceService);
  assert.ok(composition.generationService instanceof OwnerHailuo02I2vGenerationService);
  assert.equal(runtime.serverOptions.ownerHailuo02T2v, undefined);
  assert.equal(OWNER_HAILUO02_I2V_GENERATION_CATALOG_VERSION, OWNER_HAILUO02_I2V_SOURCE_PINS.public_catalog_version);

  const revokedAttempt = "link_hailuo_i2v_runtime_revoke_00001";
  await runtime.authStore.createAttempt({ attempt_id: revokedAttempt, binding: runtime.authBinding,
    expires_at_ms: Date.now() + 60_000 });
  assert.ok(runtime.serverOptions.auth);
  await runtime.serverOptions.auth.linkService.revoke(runtime.authBinding, revokedAttempt);
  assert.equal((await runtime.linkService.getStatus(runtime.authBinding, revokedAttempt)).status, "REVOKED");
  assert.equal(networkCalls, 0);

  const events: string[] = [];
  const input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const args: unknown[] = new Array(42).fill(undefined);
  args[0] = transport;
  args[5] = () => { events.push("auth.close"); };
  args[6] = input;
  args[41] = { async close() { events.push("hailuo.lifecycle.close"); await runtime.ownerHailuo02I2vLifecycle?.close(); } };
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["hailuo.lifecycle.close", "auth.close"]);
    assert.equal(networkCalls, 0);
    await assert.rejects(composition.generationService.listRecoveries({ attemptId: "link_hailuo_runtime_0000000001" }),
      { code: "SERVICE_CLOSED" });
    await assert.rejects(composition.imageReferenceService.uploadImage({}), { code: "SERVICE_CLOSED" });
  } finally {
    await runtime.ownerHailuo02I2vLifecycle?.close();
    input.destroy();
    runtime.authStore.close?.();
  }
});

test("Hailuo-02 I2V runtime remains absent by default", () => {
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("No network expected"); } });
  try { assert.equal(runtime.serverOptions.ownerHailuo02I2v, undefined); }
  finally { runtime.authStore.close?.(); }
});
