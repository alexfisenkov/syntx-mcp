import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import test from "node:test";
import { OwnerWan27R2vReferenceUploadService } from "../src/application/owner-wan27-r2v-reference-upload-service.js";
import { OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES } from "../src/mcp/owner-wan27-r2v-reference-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerWan27R2vFlag, readOwnerWan27R2vOperatorConfiguration } from "../src/transports/stdio-owner.js";

const ATTEMPT = "link_wan27_mcp_runtime_owner_0123456789";
const PINNED_MEDIA_TOOLS = Object.freeze({ ownerWan27R2vFfprobePath: "/synthetic/bin/ffprobe",
  ownerWan27R2vFfmpegPath: "/synthetic/bin/ffmpeg" });
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png240(): Buffer {
  const bytes = Buffer.from(PIXEL); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: ATTEMPT, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, ATTEMPT);
  await runtime.authStore.attachChallenge(binding, ATTEMPT, "synthetic-wan27-r2v");
  await runtime.authStore.beginPoll(binding, ATTEMPT);
  await runtime.authStore.markLinked(binding, ATTEMPT, { scheme: "Bearer", value: "synthetic-wan27-r2v-credential" });
}

test("WAN27 R2V MCP inputs are owner-stdio opt-in, closed, bounded and project safe manifest receipts", async () => {
  assert.equal(readOwnerWan27R2vFlag(undefined), false);
  assert.equal(readOwnerWan27R2vFlag(""), false);
  assert.equal(readOwnerWan27R2vFlag("0"), false);
  assert.equal(readOwnerWan27R2vFlag("1"), true);
  for (const value of ["true", "01", " 1", "1 ", "2"]) assert.throws(() => readOwnerWan27R2vFlag(value));
  assert.equal(readOwnerWan27R2vOperatorConfiguration(false, undefined, undefined), undefined);
  assert.throws(() => readOwnerWan27R2vOperatorConfiguration(true, "/ffprobe", undefined));
  assert.throws(() => readOwnerWan27R2vOperatorConfiguration(true, "ffprobe", "/ffmpeg"));

  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("unexpected startup network"); } });
  assert.equal(defaultRuntime.serverOptions.ownerWan27R2v, undefined);
  const forged = Object.freeze({ referenceUploadService: Object.freeze({
    createManifest: async () => ({}), uploadImage: async () => ({}), uploadVideo: async () => ({}), finalizeManifest: async () => ({})
  }) });
  assert.throws(() => createMcpServer(defaultRuntime.application, { ownerWan27R2v: forged } as never),
    /OWNER_WAN27_R2V_COMPOSITION_INVALID/u);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "wan27-r2v-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport); await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES.includes(name as typeof OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES[number])), false);
  } finally { await Promise.all([defaultClient.close(), defaultServer.close()]); }

  let uploads = 0;
  const runtime = createObservedOwnerRuntime({ ownerWan27R2vEnabled: true, ...PINNED_MEDIA_TOOLS,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST"); uploads += 1;
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `synthetic-${uploads}`, url: `https://r2.syntx.ai/wan27/${uploads}`,
        filename: file.name, content_type: file.type, size: file.size }] });
    } });
  const composition = runtime.serverOptions.ownerWan27R2v;
  assert.ok(composition);
  assert.ok(composition.referenceUploadService instanceof OwnerWan27R2vReferenceUploadService);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan27-r2v-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map(({ name }) => name).filter((name) => OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES.includes(
      name as typeof OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES[number])), OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES);
    const videoTool = listed.find(({ name }) => name === "syntx_owner_upload_wan27_r2v_video");
    assert.ok(videoTool);
    assert.deepEqual(Object.keys(videoTool.inputSchema.properties as object).sort(),
      ["link_attempt_id", "manifest_handle", "filename", "mime_type", "content_base64", "start_seconds", "end_seconds"].sort());
    assert.equal((videoTool.inputSchema.additionalProperties ?? false), false);

    await linkSyntheticAttempt(runtime);
    const parameters = await client.callTool({ name: "syntx_get_wan27_r2v_parameters", arguments: {} });
    assert.equal(parameters.isError, undefined);
    assert.equal((parameters.structuredContent as { model_id: string }).model_id, "wan_27_r2v");

    const draftResult = await client.callTool({ name: "syntx_owner_create_wan27_r2v_manifest", arguments: {
      link_attempt_id: ATTEMPT, video_reference_count: 0
    } });
    assert.equal(draftResult.isError, undefined, JSON.stringify(draftResult));
    const draft = draftResult.structuredContent as { manifest_handle: string; status: string };
    assert.equal(draft.status, "draft");
    const image = png240();
    const itemResult = await client.callTool({ name: "syntx_owner_upload_wan27_r2v_image", arguments: {
      link_attempt_id: ATTEMPT, manifest_handle: draft.manifest_handle, filename: "frame.png", mime_type: "image/png",
      content_base64: image.toString("base64")
    } });
    assert.equal(itemResult.isError, undefined, JSON.stringify(itemResult));
    const item = itemResult.structuredContent as Record<string, unknown>;
    assert.equal(item.status, "item");
    assert.equal(JSON.stringify(item).includes("https://"), false);
    assert.equal(JSON.stringify(item).includes("sha256"), false);
    assert.equal(uploads, 1);
    const readyResult = await client.callTool({ name: "syntx_owner_finalize_wan27_r2v_manifest", arguments: {
      link_attempt_id: ATTEMPT, manifest_handle: draft.manifest_handle
    } });
    assert.equal(readyResult.isError, undefined, JSON.stringify(readyResult));
    const ready = readyResult.structuredContent as { status: string; references: unknown[]; generation_permit: boolean };
    assert.equal(ready.status, "ready"); assert.equal(ready.references.length, 1); assert.equal(ready.generation_permit, false);

    for (const bad of [
      { link_attempt_id: ATTEMPT, video_reference_count: 6 },
      { link_attempt_id: ATTEMPT, video_reference_count: 0, prompt: "arbitrary payload" }
    ]) {
      const rejected = await client.callTool({ name: "syntx_owner_create_wan27_r2v_manifest", arguments: bad });
      assert.equal(rejected.isError, true);
    }
    const malformedImage = await client.callTool({ name: "syntx_owner_upload_wan27_r2v_image", arguments: {
      link_attempt_id: ATTEMPT, manifest_handle: draft.manifest_handle, filename: "frame.png", mime_type: "image/png", content_base64: "%%%="
    } });
    assert.equal(malformedImage.isError, true); assert.equal(uploads, 1);
    const eofInput = new PassThrough();
    assert.ok(runtime.ownerWan27R2vLifecycle);
    const closeEof = closeOwnerReadServicesOnTransportEof(serverTransport, runtime.ownerWan27R2vLifecycle,
      undefined, undefined, undefined, undefined, eofInput);
    eofInput.end();
    await closeEof();
    await assert.rejects(composition.referenceUploadService.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 }));
  } finally {
    await Promise.all([client.close(), server.close()]);
    await runtime.ownerWan27R2vLifecycle?.close();
  }
});
