import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { describeRemoteMediaFileTool } from "../src/runtime/remote-owner-media-file-input.js";
import { normalizeRemoteOwnerToolSchemas } from "../src/runtime/remote-owner-schema-compatibility.js";

const cases = [
  { name: "syntx_upload_video2audio_original", mime: "video/mp4", model: null, extension: "mp4" },
  { name: "syntx_owner_upload_wan26_i2v_image", mime: "image/png", model: "wan_26_i2v", extension: "png" },
  { name: "syntx_owner_upload_wan26_i2v_audio", mime: "audio/wav", model: "wan_26_i2v", extension: "wav" },
  { name: "syntx_owner_upload_wan26_r2v_image", mime: "image/png", model: "wan_26_r2v", extension: "png" },
  { name: "syntx_owner_upload_wan26_r2v_selected_video", mime: "video/mp4", model: "wan_26_r2v", extension: "mp4" },
  { name: "syntx_owner_upload_wan25_i2v_preview_image", mime: "image/png", model: "wan_25_i2v_preview", extension: "png" }
] as const;

function firstText(result: unknown): string {
  const content = result && typeof result === "object" ? (result as { content?: unknown }).content : undefined;
  const first = Array.isArray(content) ? content[0] : undefined;
  return first && typeof first === "object" && first.type === "text" && typeof first.text === "string" ? first.text : "";
}

test("six actual SDK upload descriptors omit flagless Unicode patterns while runtime filename guards remain exact", async () => {
  let networkCalls = 0;
  // No media call is authorized. The path is a configuration placeholder and
  // the guard rejects malformed names before any owned media service can run.
  const runtime = createObservedOwnerRuntime({ ownerWan25I2vPreviewEnabled: true, ownerWan26I2vEnabled: true,
    ownerWan26I2vFfprobePath: process.execPath, ownerWan26R2vEnabled: true,
    ownerWan26R2vFfprobePath: process.execPath, ownerWan26R2vFfmpegPath: process.execPath,
    ownerVideo2AudioEnabled: true, ownerVideo2AudioFfprobePath: process.execPath,
    catalogDirectory: `${process.cwd()}/catalog`, fetchImpl: async () => { networkCalls++; throw new Error("NETWORK_FORBIDDEN"); } });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "unicode-filename-descriptor-test", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const listed = (await client.listTools()).tools;
    assert.equal(cases.filter(({ name }) => listed.some((tool) => tool.name === name)).length, 6);
    for (const entry of cases) {
      const tool = listed.find((item) => item.name === entry.name)!;
      const remote = normalizeRemoteOwnerToolSchemas(describeRemoteMediaFileTool(tool));
      const filename = remote.inputSchema.properties?.filename as { pattern?: string; minLength?: number; maxLength?: number; description?: string };
      assert.equal(filename.pattern, undefined, `${entry.name}: Unicode predicate stays server-side`);
      assert.equal(filename.minLength, 1); assert.equal(filename.maxLength, 255);
      assert.match(filename.description ?? "", /checked server-side/u);
      assert.deepEqual(remote._meta?.["openai/fileParams"], ["file"]);
      const file = remote.inputSchema.properties?.file as { properties: Record<string, unknown>; required: string[] };
      assert.deepEqual(Object.keys(file.properties).sort(), ["download_url", "file_id", "file_name", "mime_type"].sort());
      assert.deepEqual(file.required, ["download_url", "file_id"]);

      const base: Record<string, unknown> = { link_attempt_id: `link_${"a".repeat(25)}`, content_base64: "AAAA".repeat(6), mime_type: entry.mime,
        ...(entry.model === null ? {} : { model_id: entry.model }),
        ...(entry.name.includes("selected_video") ? { start_seconds: 0, end_seconds: 1, total_reference_count: 1 } : {}) };
      for (const badName of [`bad/name.${entry.extension}`, `bad\\name.${entry.extension}`,
        `bad\u0001name.${entry.extension}`, `bad\u200Bname.${entry.extension}`]) {
        const result = await client.callTool({ name: entry.name, arguments: { ...base, filename: badName } });
        assert.equal(result.isError, true);
        assert.match(firstText(result), /^MCP error -32602: Input validation error/u);
      }
      const goodName = `пример.${entry.extension}`;
      const acceptedByParser = await client.callTool({ name: entry.name, arguments: { ...base, filename: goodName } });
      assert.doesNotMatch(firstText(acceptedByParser), /^MCP error -32602: Input validation error/u);
    }
    assert.equal(networkCalls, 0);
  } finally {
    await client.close(); await server.close();
    await Promise.all([runtime.ownerWan25I2vPreviewLifecycle?.close(), runtime.ownerWan26I2vLifecycle?.close(),
      runtime.ownerWan26R2vLifecycle?.close(), runtime.ownerVideo2AudioLifecycle?.close()]);
    runtime.authStore.close?.();
  }
});
