import assert from "node:assert/strict";
import test from "node:test";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OwnerTopazAstraGenerationService } from "../src/application/owner-topaz-astra-generation-service.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import { readOwnerTopazAstraFlag, readOwnerTopazAstraOperatorConfiguration } from "../src/runtime/owner-topaz-astra-stdio-config.js";

test("Topaz stdio opt-in is strict and requires trusted ffprobe path plus upload destination", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerTopazAstraFlag(value), false);
  assert.equal(readOwnerTopazAstraFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerTopazAstraFlag(value), /Invalid SYNTX_OWNER_TOPAZ_ASTRA configuration/u);
  }
  assert.equal(readOwnerTopazAstraOperatorConfiguration(false, undefined, undefined), undefined);
  assert.throws(() => readOwnerTopazAstraOperatorConfiguration(true, undefined, "uploaded"), /operator configuration/u);
  assert.throws(() => readOwnerTopazAstraOperatorConfiguration(true, "ffprobe", "uploaded"), /operator configuration/u);
  assert.throws(() => readOwnerTopazAstraOperatorConfiguration(true, "/usr/bin/ffprobe", undefined), /operator configuration/u);
  assert.throws(() => readOwnerTopazAstraOperatorConfiguration(true, "/usr/bin/ffprobe", "default"), /operator configuration/u);
  assert.deepEqual(readOwnerTopazAstraOperatorConfiguration(true, "/usr/bin/ffprobe", "hidden"),
    { ffprobePath: "/usr/bin/ffprobe", destination: "hidden" });
});

test("Topaz runtime is default-off and rejects incomplete trusted configuration without network access", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaults.serverOptions.ownerTopazAstra, undefined);
  assert.equal(defaults.ownerTopazAstraLifecycle, undefined);
  await assert.rejects(Promise.resolve().then(() => createObservedOwnerRuntime({ ownerTopazAstraEnabled: true, fetchImpl })),
    /OWNER_TOPAZ_ASTRA_OPERATOR_CONFIGURATION_REQUIRED/u);

  const runtime = createObservedOwnerRuntime({ ownerTopazAstraEnabled: true,
    ownerTopazAstraFfprobePath: "/usr/bin/ffprobe", ownerTopazAstraUploadDestination: "uploaded", fetchImpl });
  try {
    const composition = runtime.serverOptions.ownerTopazAstra;
    assert.ok(composition);
    assert.equal(composition.generationService instanceof OwnerTopazAstraGenerationService, true);
    assert.equal(composition.originalReferenceService instanceof OwnerTopazAstraOriginalReferenceService, true);
    assert.ok(runtime.ownerTopazAstraLifecycle);
    assert.equal(fetchCalls, 0, "composition must not make startup network requests");
  } finally {
    await runtime.ownerTopazAstraLifecycle?.close();
    runtime.authStore.close?.();
  }
});

test("Topaz lifecycle invalidates generation-owned candidate state before original upload state", async () => {
  const runtime = createObservedOwnerRuntime({ ownerTopazAstraEnabled: true,
    ownerTopazAstraFfprobePath: "/usr/bin/ffprobe", ownerTopazAstraUploadDestination: "hidden",
    fetchImpl: async () => { throw new Error("No startup request expected"); } });
  const events: string[] = [];
  const target = [OwnerTopazAstraGenerationService.prototype, "invalidateAttempt"] as const;
  const original = [OwnerTopazAstraOriginalReferenceService.prototype, "invalidateAttempt"] as const;
  const descriptors = [target, original].map(([prototype, key]) => Object.getOwnPropertyDescriptor(prototype, key)!);
  try {
    for (const [index, pair] of [target, original].entries()) {
      const descriptor = descriptors[index]!;
      const method = descriptor.value as (attemptId: string) => Promise<void>;
      Object.defineProperty(pair[0], pair[1], { ...descriptor, value: async function (this: object, attemptId: string) {
        events.push(index === 0 ? "generation.invalidate" : "original.invalidate");
        return Reflect.apply(method, this, [attemptId]) as Promise<void>;
      } });
    }
    await runtime.ownerTopazAstraLifecycle?.invalidateAttempt("link_123456789012345678901234");
    assert.deepEqual(events, ["generation.invalidate", "original.invalidate"]);
  } finally {
    [target, original].forEach(([prototype, key], index) => Object.defineProperty(prototype, key, descriptors[index]!));
    await runtime.ownerTopazAstraLifecycle?.close();
    runtime.authStore.close?.();
  }
});

test("Topaz EOF lifecycle waits for generation drain before closing the borrowed original service", async () => {
  const runtime = createObservedOwnerRuntime({ ownerTopazAstraEnabled: true,
    ownerTopazAstraFfprobePath: "/usr/bin/ffprobe", ownerTopazAstraUploadDestination: "hidden",
    fetchImpl: async () => { throw new Error("No startup request expected"); } });
  const events: string[] = [];
  let finishGeneration!: () => void;
  const target = [OwnerTopazAstraGenerationService.prototype, "close"] as const;
  const original = [OwnerTopazAstraOriginalReferenceService.prototype, "close"] as const;
  const descriptors = [target, original].map(([prototype, key]) => Object.getOwnPropertyDescriptor(prototype, key)!);
  try {
    const generationClose = descriptors[0]!.value as () => Promise<void>;
    const originalClose = descriptors[1]!.value as () => Promise<void>;
    Object.defineProperty(target[0], target[1], { ...descriptors[0], value: function (this: object) {
      events.push("generation.close.start");
      return new Promise<void>((resolve, reject) => { finishGeneration = () => {
        events.push("generation.close.done");
        Reflect.apply(generationClose, this, []).then(resolve, reject);
      }; });
    } });
    Object.defineProperty(original[0], original[1], { ...descriptors[1], value: function (this: object) {
      events.push("original.close");
      return Reflect.apply(originalClose, this, []) as Promise<void>;
    } });
    const closing = runtime.ownerTopazAstraLifecycle?.close();
    await Promise.resolve();
    assert.deepEqual(events, ["generation.close.start"]);
    finishGeneration();
    await closing;
    assert.deepEqual(events, ["generation.close.start", "generation.close.done", "original.close"]);
  } finally {
    [target, original].forEach(([prototype, key], index) => Object.defineProperty(prototype, key, descriptors[index]!));
    await runtime.ownerTopazAstraLifecycle?.close();
    runtime.authStore.close?.();
  }
});
