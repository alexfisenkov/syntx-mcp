import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OwnerElevenLabsStsGenerationService } from "../src/application/owner-elevenlabs-sts-generation-service.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { OwnerElevenLabsTtsGenerationService } from "../src/application/owner-elevenlabs-tts-generation-service.js";
import { OwnerElevenLabsDialogueGenerationService } from "../src/application/owner-elevenlabs-dialogue-generation-service.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerElevenLabsStsFlag,
  readOwnerElevenLabsStsOperatorConfiguration } from "../src/transports/stdio-owner.js";

test("STS operator flag is strict/default-off and requires explicit trusted ffprobe and destination", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerElevenLabsStsFlag(value), false);
  assert.equal(readOwnerElevenLabsStsFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerElevenLabsStsFlag(value), /Invalid SYNTX_OWNER_ELEVENLABS_STS configuration/u);
  }
  assert.equal(readOwnerElevenLabsStsOperatorConfiguration(false, undefined, undefined), undefined);
  assert.throws(() => readOwnerElevenLabsStsOperatorConfiguration(true, undefined, "hidden"), /operator configuration/u);
  assert.throws(() => readOwnerElevenLabsStsOperatorConfiguration(true, "ffprobe", "hidden"), /operator configuration/u);
  assert.throws(() => readOwnerElevenLabsStsOperatorConfiguration(true, "/usr/bin/ffprobe", undefined), /operator configuration/u);
  assert.throws(() => readOwnerElevenLabsStsOperatorConfiguration(true, "/usr/bin/ffprobe", "default"), /operator configuration/u);
  assert.deepEqual(readOwnerElevenLabsStsOperatorConfiguration(true, "/usr/bin/ffprobe", "uploaded"),
    { ffprobePath: "/usr/bin/ffprobe", destination: "uploaded" });
});

test("runtime keeps STS default-off and composes STS with the shared ElevenLabs voice and chat clients", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaults.serverOptions.ownerElevenLabsSts, undefined);
  assert.equal(defaults.ownerElevenLabsStsLifecycle, undefined);
  await assert.rejects(Promise.resolve().then(() => createObservedOwnerRuntime({ ownerElevenLabsStsEnabled: true, fetchImpl })),
    /OWNER_ELEVENLABS_STS_OPERATOR_CONFIGURATION_REQUIRED/u);

  const stsOnly = createObservedOwnerRuntime({ ownerElevenLabsStsEnabled: true,
    ownerElevenLabsStsFfprobePath: "/usr/bin/ffprobe", ownerElevenLabsStsUploadDestination: "hidden", fetchImpl });
  try {
    assert.ok(stsOnly.serverOptions.ownerElevenLabsSts);
    assert.equal(stsOnly.serverOptions.ownerElevenLabsTts, undefined);
    assert.equal(stsOnly.serverOptions.ownerElevenLabsDialogue, undefined);
  } finally {
    await stsOnly.ownerElevenLabsStsLifecycle?.close();
    stsOnly.authStore.close?.();
  }

  const runtime = createObservedOwnerRuntime({ ownerElevenLabsTtsEnabled: true, ownerElevenLabsDialogueEnabled: true, ownerElevenLabsStsEnabled: true,
    ownerElevenLabsStsFfprobePath: "/usr/bin/ffprobe", ownerElevenLabsStsUploadDestination: "hidden", fetchImpl });
  try {
    const tts = runtime.serverOptions.ownerElevenLabsTts;
    const dialogue = runtime.serverOptions.ownerElevenLabsDialogue;
    const sts = runtime.serverOptions.ownerElevenLabsSts;
    assert.ok(tts && dialogue && sts);
    assert.equal(sts.voiceReferenceService, tts.voiceReferenceService);
    assert.equal(sts.voiceReferenceService, dialogue.voiceReferenceService);
    assert.equal(sts.generationService instanceof OwnerElevenLabsStsGenerationService, true);
    assert.equal(sts.originalReferenceService instanceof OwnerElevenLabsStsOriginalReferenceService, true);
    assert.equal(sts.voiceReferenceService instanceof OwnerElevenLabsVoiceReferenceService, true);
    assert.equal(runtime.ownerElevenLabsStsLifecycle, runtime.ownerElevenLabsTtsLifecycle);
    assert.equal(runtime.ownerElevenLabsStsLifecycle, runtime.ownerElevenLabsDialogueLifecycle);
    assert.equal(fetchCalls, 0, "composition must not make startup network requests");
  } finally {
    await runtime.ownerElevenLabsStsLifecycle?.close();
    runtime.authStore.close?.();
  }
});

test("STS/TTS/dialogue EOF drains each generation and shared service once before owner auth release", async () => {
  const runtime = createObservedOwnerRuntime({ ownerElevenLabsTtsEnabled: true, ownerElevenLabsDialogueEnabled: true,
    ownerElevenLabsStsEnabled: true,
    ownerElevenLabsStsFfprobePath: "/usr/bin/ffprobe", ownerElevenLabsStsUploadDestination: "hidden",
    fetchImpl: async () => { throw new Error("No startup request expected"); } });
  const input = new PassThrough();
  const events: string[] = [];
  const lifecycle = runtime.ownerElevenLabsStsLifecycle;
  assert.ok(lifecycle);
  const originals = [
    [OwnerElevenLabsStsGenerationService.prototype, "close"],
    [OwnerElevenLabsTtsGenerationService.prototype, "close"],
    [OwnerElevenLabsDialogueGenerationService.prototype, "close"],
    [OwnerElevenLabsStsOriginalReferenceService.prototype, "close"],
    [OwnerElevenLabsVoiceReferenceService.prototype, "close"]
  ] as const;
  const descriptors = originals.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key)!);
  const labels = ["sts-generation-and-preparer", "tts-generation", "dialogue-generation", "original", "voice"];
  try {
    originals.forEach(([target, key], index) => {
      const original = descriptors[index]!.value as (...args: never[]) => Promise<void>;
      Object.defineProperty(target, key, { ...descriptors[index], value: function (this: object) {
        events.push(labels[index]!);
        return Reflect.apply(original, this, []);
      } });
    });
    const args: unknown[] = Array.from({ length: 40 }, () => undefined);
    args[0] = { onclose: undefined, async close() {} } as unknown as Transport;
    args[5] = () => events.push("auth.release"); args[6] = input; args[19] = true;
    args[24] = runtime.ownerElevenLabsTtsLifecycle;
    args[32] = runtime.ownerElevenLabsDialogueLifecycle;
    args[33] = lifecycle;
    const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
    await close();
    assert.deepEqual(events, ["sts-generation-and-preparer", "tts-generation", "dialogue-generation", "original", "voice", "auth.release"]);
  } finally {
    originals.forEach(([target, key], index) => Object.defineProperty(target, key, descriptors[index]!));
    input.destroy();
    runtime.authStore.close?.();
  }
});

