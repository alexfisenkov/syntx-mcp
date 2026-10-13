import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES } from "../src/mcp/owner-elevenlabs-dialogue-tools.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("dialogue-only and combined TTS runtime share genuine voices and register the voice tool once", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => { networkCalls++; throw new Error("Unexpected network"); };
  for (const tts of [false, true]) {
    const runtime = createObservedOwnerRuntime({ ownerElevenLabsDialogueEnabled: true, ownerElevenLabsTtsEnabled: tts, fetchImpl });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "dialogue-composition", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const names = (await client.listTools()).tools.map((item) => item.name);
      assert.equal(names.filter((name) => name === "syntx_owner_list_elevenlabs_voice_references").length, 1);
      for (const name of SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES) assert.equal(names.filter((item) => item === name).length, 1);
      assert.equal(names.includes("syntx_owner_generate_elevenlabs_tts"), tts);
      if (tts) assert.equal(runtime.serverOptions.ownerElevenLabsTts?.voiceReferenceService,
        runtime.serverOptions.ownerElevenLabsDialogue?.voiceReferenceService);
      const source = await client.callTool({ name: SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[0], arguments: {} });
      assert.notEqual(source.isError, true);
      assert.equal((source.structuredContent as { models: unknown[] }).models.length, 3);
      const invalid = await client.callTool({ name: SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[1], arguments: {
        link_attempt_id: "link_dialogue_composition_0123456789", model_id: "eleven_v3", mode: "text_to_dialogue", prompt: "",
        stability: 0.5, similarity_boost: 0.5, inputs: [{ name: "A", text: "Test", voice_id: "raw-not-allowed" }]
      } });
      assert.equal(invalid.isError, true);
      assert.equal(networkCalls, 0);
    } finally {
      await runtime.ownerElevenLabsDialogueLifecycle?.close(); await runtime.ownerElevenLabsTtsLifecycle?.close();
      await client.close(); await server.close(); runtime.authStore.close?.();
    }
  }
});

test("new appended Hailuo02/dialogue EOF lifecycles drain before auth, retaining older positional ABI", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined, async close() {} };
  // Function.length ends at the first defaulted argument (input), not the full ABI.
  const args: unknown[] = Array.from({ length: 33 }, () => undefined);
  args[0] = transport; args[5] = () => { events.push("auth"); }; args[6] = input;
  args[args.length - 2] = { async close() { events.push("hailuo02"); } };
  args[args.length - 1] = { async close() { events.push("dialogue"); } };
  try {
    await (Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>)();
    assert.deepEqual(events, ["hailuo02", "dialogue", "auth"]);
  } finally { input.destroy(); }
});

test("invalid dialogue opt-in and durable conflict fail before stdio attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([key]) => key.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    process.env.SYNTX_OWNER_ELEVENLABS_DIALOGUE = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_ELEVENLABS_DIALOGUE configuration/u);
    process.env.SYNTX_OWNER_ELEVENLABS_DIALOGUE = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    for (const [key, value] of prior) process.env[key] = value;
  }
});
