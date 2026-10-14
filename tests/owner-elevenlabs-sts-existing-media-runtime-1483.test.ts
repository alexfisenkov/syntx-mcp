import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OwnerElevenLabsStsGenerationService } from "../src/application/owner-elevenlabs-sts-generation-service.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import { OwnerElevenLabsStsExistingMediaService } from "../src/application/owner-elevenlabs-sts-existing-media-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OWNER_ELEVENLABS_STS_EXISTING_MEDIA_TOOL_NAMES } from "../src/mcp/owner-elevenlabs-sts-existing-media-tools.js";

test("1483 STS reader stays default-off and joins opted-in shared services and close lifecycle exactly once", async () => {
  const noNetwork: typeof fetch = async () => { throw new Error("Runtime composition must not make startup requests."); };
  const defaults = createObservedOwnerRuntime({ fetchImpl: noNetwork });
  assert.equal(defaults.serverOptions.ownerElevenLabsSts, undefined);
  const defaultServer = createMcpServer(defaults.application, defaults.serverOptions);
  const defaultClient = new Client({ name: "sts-existing-default-off-1483", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport); await defaultClient.connect(defaultClientTransport);
  const defaultNames = (await defaultClient.listTools()).tools.map(({ name }) => name);
  assert.equal(defaultNames.some((name) => (OWNER_ELEVENLABS_STS_EXISTING_MEDIA_TOOL_NAMES as readonly string[]).includes(name)), false);
  await Promise.allSettled([defaultClient.close(), defaultServer.close()]); defaults.authStore.close?.();

  const runtime = createObservedOwnerRuntime({ ownerElevenLabsTtsEnabled: true, ownerElevenLabsDialogueEnabled: true,
    ownerElevenLabsStsEnabled: true, ownerElevenLabsStsFfprobePath: "/usr/bin/ffprobe",
    ownerElevenLabsStsUploadDestination: "hidden", fetchImpl: noNetwork });
  const sts = runtime.serverOptions.ownerElevenLabsSts;
  assert.ok(sts);
  assert.ok(sts.existingMediaService instanceof OwnerElevenLabsStsExistingMediaService);
  assert.ok(sts.generationService instanceof OwnerElevenLabsStsGenerationService);
  assert.ok(sts.originalReferenceService instanceof OwnerElevenLabsStsOriginalReferenceService);
  assert.ok(sts.voiceReferenceService instanceof OwnerElevenLabsVoiceReferenceService);
  assert.equal(sts.voiceReferenceService, runtime.serverOptions.ownerElevenLabsTts?.voiceReferenceService);
  assert.equal(sts.voiceReferenceService, runtime.serverOptions.ownerElevenLabsDialogue?.voiceReferenceService);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "sts-existing-combined-1483", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const names = (await client.listTools()).tools.map(({ name }) => name);
  for (const name of OWNER_ELEVENLABS_STS_EXISTING_MEDIA_TOOL_NAMES) assert.ok(names.includes(name));
  assert.equal(names.filter((name) => name === "syntx_owner_list_existing_elevenlabs_sts_results").length, 1);

  const events: string[] = [];
  const entries = [
    [OwnerElevenLabsStsExistingMediaService.prototype, "close", "existing"],
    [OwnerElevenLabsStsGenerationService.prototype, "close", "generation"],
    [OwnerElevenLabsStsOriginalReferenceService.prototype, "close", "original"],
    [OwnerElevenLabsVoiceReferenceService.prototype, "close", "voice"]
  ] as const;
  const descriptors = entries.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key)!);
  try {
    entries.forEach(([target, key, label], index) => {
      const original = descriptors[index]!.value as (...args: never[]) => Promise<void>;
      Object.defineProperty(target, key, { ...descriptors[index], value: function (this: object) {
        events.push(label);
        return Reflect.apply(original, this, []);
      } });
    });
    const lifecycle = runtime.ownerElevenLabsStsLifecycle;
    assert.ok(lifecycle);
    await lifecycle.close(); await lifecycle.close();
    assert.deepEqual(events, ["existing", "generation", "original", "voice"]);
  } finally {
    entries.forEach(([target, key], index) => Object.defineProperty(target, key, descriptors[index]!));
    await Promise.allSettled([client.close(), server.close()]); runtime.authStore.close?.();
  }
});
