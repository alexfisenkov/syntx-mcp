import assert from "node:assert/strict";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerWan30FirstLastVideosFlag } from "../src/transports/stdio-owner.js";
import { isOwnerWan30FirstLastGenerationService } from "../src/application/owner-wan30-first-last-generation-service.js";

const CATALOG_DIRECTORY = fileURLToPath(new URL("../../catalog", import.meta.url));

test("Wan30 First/Last opt-in flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerWan30FirstLastVideosFlag(value), false);
  assert.equal(readOwnerWan30FirstLastVideosFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerWan30FirstLastVideosFlag(value), /Invalid SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS configuration/u);
  }
});

test("runtime composes only the exact C19 Wan30 service on opt-in and closes it without provider traffic", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("No provider network is allowed during runtime composition or cleanup.");
  };
  const defaults = createObservedOwnerRuntime({ catalogDirectory: CATALOG_DIRECTORY, fetchImpl });
  assert.equal(defaults.serverOptions.ownerWan30FirstLastVideos, undefined);
  assert.equal(defaults.ownerWan30FirstLastVideosLifecycle, undefined);

  const enabled = createObservedOwnerRuntime({ ownerWan30FirstLastVideosEnabled: true,
    catalogDirectory: CATALOG_DIRECTORY, fetchImpl });
  const composition = enabled.serverOptions.ownerWan30FirstLastVideos;
  assert.ok(composition, "MISSING_OWNER_WAN30_FIRST_LAST_COMPOSITION");
  const service = composition.generationService;
  assert.equal(isOwnerWan30FirstLastGenerationService(service), true, "runtime uses the real branded service");
  assert.equal(typeof service.upload, "function");
  assert.equal(typeof service.generate, "function");
  assert.equal(typeof service.invalidateAttempt, "function");
  assert.equal(typeof service.close, "function");
  assert.ok(enabled.ownerWan30FirstLastVideosLifecycle, "MISSING_OWNER_WAN30_FIRST_LAST_LIFECYCLE");
  assert.equal(fetchCalls, 0);
  await enabled.ownerWan30FirstLastVideosLifecycle.close();
  await service.close();
  assert.equal(fetchCalls, 0);
});

test("missing exact C19 archive fails closed at explicit operator catalog directory", () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("No provider network is allowed during catalog binding.");
  };
  const missingDirectory = join(CATALOG_DIRECTORY, "public");
  assert.throws(() => createObservedOwnerRuntime({ ownerWan30FirstLastVideosEnabled: true,
    catalogDirectory: missingDirectory, fetchImpl }));
  assert.equal(fetchCalls, 0, "the exact First/Last profile must not fall back to a different archive");
});

test("stdio EOF closer consumes the First/Last lifecycle in its final optional slot", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined as (() => void) | undefined, async close() { events.push("transport.close"); } };
  const preceding = new Array(12).fill(undefined);
  const trailing = new Array(27).fill(undefined);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, [
    transport as never,
    undefined, undefined, undefined, undefined,
    undefined, input,
    ...preceding,
    false,
    ...trailing,
    { async close() { events.push("wan30-first-last.close"); } }
  ]) as () => Promise<void>;
  await close();
  assert.deepEqual(events, ["wan30-first-last.close"]);
  input.destroy();
});
