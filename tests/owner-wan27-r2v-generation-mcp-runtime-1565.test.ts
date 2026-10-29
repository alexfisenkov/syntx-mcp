import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import test from "node:test";
import { OWNER_WAN27_R2V_GENERATION_TOOL_NAMES } from "../src/mcp/owner-wan27-r2v-generation-tools.js";
import { OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES } from "../src/mcp/owner-wan27-r2v-reference-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerWan27R2vFlag } from "../src/transports/stdio-owner.js";

const ATTEMPT = "link_wan27_gen_runtime_1565_0123456789";
const OUTPUT = "https://r2.syntx.ai/generated/wan27-r2v-1565.mp4";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const MEDIA_TOOLS = Object.freeze({ ownerWan27R2vFfprobePath: "/synthetic/bin/ffprobe", ownerWan27R2vFfmpegPath: "/synthetic/bin/ffmpeg" });
function crc32(bytes: Uint8Array): number { let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); } return (crc ^ 0xffff_ffff) >>> 0; }
function png240(): Buffer { const bytes = Buffer.from(PNG); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes; }
async function link(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<void> {
  const binding = runtime.authBinding; await runtime.authStore.createAttempt({ attempt_id: ATTEMPT, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, ATTEMPT); await runtime.authStore.attachChallenge(binding, ATTEMPT, "synthetic-wan27-1565");
  await runtime.authStore.beginPoll(binding, ATTEMPT); await runtime.authStore.markLinked(binding, ATTEMPT, { scheme: "Bearer", value: "synthetic-wan27-r2v-1565" });
}

test("1565 WAN R2V runtime exposes 9 opt-in SDK tools, performs one synthetic GEN and drains on revoke and EOF", async () => {
  assert.equal(readOwnerWan27R2vFlag(undefined), false);
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("unexpected default runtime fetch"); } });
  assert.equal(defaultRuntime.serverOptions.ownerWan27R2v, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions), defaultClient = new Client({ name: "wan27-default-1565", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport); await defaultClient.connect(defaultClientTransport);
  try { const names = (await defaultClient.listTools()).tools.map(({ name }) => name); assert.equal(names.some((name) => OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES.includes(name as typeof OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES[number])), false); assert.equal(names.some((name) => OWNER_WAN27_R2V_GENERATION_TOOL_NAMES.includes(name as typeof OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[number])), false); }
  finally { await Promise.all([defaultClient.close(), defaultServer.close()]); }

  let uploads = 0, chats = 0, generations = 0, histories = 0, results = 0;
  const quoteReads: Array<{ keys: string[]; duration: string | null; video_duration: string | null; resolution: string | null }> = [];
  const chatUuid = "wan27-runtime-chat-1565", ack = "wan27-runtime-owner-ack-1565", resultId = "wan27-runtime-result-1565", objectId = "wan27-runtime-object-1565";
  const runtime = createObservedOwnerRuntime({ ownerWan27R2vEnabled: true, ...MEDIA_TOOLS, fetchImpl: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") { quoteReads.push({ keys: [...url.searchParams.keys()].sort(), duration: url.searchParams.get("duration"), video_duration: url.searchParams.get("video_duration"), resolution: url.searchParams.get("resolution") }); return Response.json({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("/chats/upload-files") && method === "POST") { uploads++; const file = (init.body as FormData).get("files"); assert.ok(file instanceof File); return Response.json({ files: [{ id: "wan27-runtime-upload-1565", filename: file.name, url: `https://r2.syntx.ai/wan27/input-${uploads}.png`, mime_type: file.type, content_type: file.type, size: file.size, status: "success" }] }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chats++; return Response.json({ uuid: chatUuid }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { generations++; assert.equal(url.search, "?ai_name=wan_video"); const body = JSON.parse(String(init.body)); assert.equal(body.settings.model_type, "wan_27_r2v"); assert.equal(body.settings.duration, 0); assert.equal(body.settings.video_duration, 4); assert.equal(body.settings.file_urls.length, 6); assert.deepEqual(Object.keys(body.settings.file_urls[0]).sort(), ["type", "url"]); return Response.json({ id: ack }); }
    if (url.pathname === `/api/v1/chats/${chatUuid}/messages` && method === "GET") { histories++; const page = Number(url.searchParams.get("page")), pageSize = Number(url.searchParams.get("page_size")); return Response.json({ messages: [
      { id: ack, chat_id: 77203, author_id: 17, message_object: [] },
      { id: resultId, chat_id: 77203, author_id: -1, message_object: [{ id: objectId, message_id: resultId, object_type: "video", model_type: "wan_27_r2v" }] }
    ], pagination: { page, page_size: pageSize, total_count: 2, total_pages: 1, has_previous: false, has_next: false } }); }
    if (url.pathname === `/api/v1/chats/${chatUuid}/${resultId}` && method === "GET") { results++; return Response.json({ id: resultId, chat_id: 77203, author_id: -1, message_object: [{ id: objectId, message_id: resultId, object_type: "video", model_type: "wan_27_r2v", completed: true, object_url: OUTPUT }] }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  } });
  const server = createMcpServer(runtime.application, runtime.serverOptions), client = new Client({ name: "wan27-generation-1565", version: "1.0.0" }), [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct); const listed = (await client.listTools()).tools;
    const wanNames = listed.map(({ name }) => name).filter((name) => OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES.includes(name as typeof OWNER_WAN27_R2V_REFERENCE_TOOL_NAMES[number]) || OWNER_WAN27_R2V_GENERATION_TOOL_NAMES.includes(name as typeof OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[number]));
    assert.equal(wanNames.length, 9); assert.deepEqual(wanNames.slice(-4), OWNER_WAN27_R2V_GENERATION_TOOL_NAMES);
    for (const name of OWNER_WAN27_R2V_GENERATION_TOOL_NAMES) { const tool = listed.find((item) => item.name === name); assert.ok(tool); assert.equal(tool.outputSchema?.type, "object"); assert.equal(tool.inputSchema.additionalProperties ?? false, false); }
    await link(runtime);
    const draftResult = await client.callTool({ name: "syntx_owner_create_wan27_r2v_manifest", arguments: { link_attempt_id: ATTEMPT, video_reference_count: 0 } });
    assert.equal(draftResult.isError, undefined, JSON.stringify(draftResult)); const manifest = draftResult.structuredContent as { manifest_handle: string };
    const image = png240();
    for (let index = 0; index < 6; index += 1) {
      const upload = await client.callTool({ name: "syntx_owner_upload_wan27_r2v_image", arguments: { link_attempt_id: ATTEMPT,
        manifest_handle: manifest.manifest_handle, filename: `frame-${index}.png`, mime_type: "image/png", content_base64: image.toString("base64") } });
      assert.equal(upload.isError, undefined, JSON.stringify(upload));
    }
    assert.equal(uploads, 6);
    const finalized = await client.callTool({ name: "syntx_owner_finalize_wan27_r2v_manifest", arguments: { link_attempt_id: ATTEMPT, manifest_handle: manifest.manifest_handle } });
    assert.equal(finalized.isError, undefined, JSON.stringify(finalized));
    assert.equal((finalized.structuredContent as { generation_permit: boolean }).generation_permit, false);
    assert.equal((finalized.structuredContent as { total_reference_count: number }).total_reference_count, 6);
    assert.equal((finalized.structuredContent as { references: unknown[] }).references.length, 6);
    const invalid = await client.callTool({ name: OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT, model_id: "wan_27_r2v", manifest_handle: manifest.manifest_handle, resolution: "720P", aspect_ratio: "16:9", video_duration: 4, prompt_extend: false, seed: null, native_audio: false, file_url: OUTPUT } });
    assert.equal(invalid.isError, true); assert.equal(generations, 0);
    const base = { link_attempt_id: ATTEMPT, model_id: "wan_27_r2v", manifest_handle: manifest.manifest_handle, prompt: "Synthetic R2V runtime proof", resolution: "1080P", aspect_ratio: "16:9", video_duration: 4, prompt_extend: false, seed: null, native_audio: false };
    const generated = await client.callTool({ name: OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[0], arguments: base }); assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const result = generated.structuredContent as { recovery_id: string; backend_acceptance: string; artifacts: Array<{ object_url: string }> };
    assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.artifacts[0]?.object_url, OUTPUT); assert.equal(generations, 1);
    assert.equal(chats, 1); assert.equal(histories, 1); assert.equal(results, 1); assert.equal(uploads, 6);
    assert.equal(quoteReads.length, 2); assert.deepEqual(quoteReads.map((read) => read.keys), [["ai_name", "duration", "model_type", "resolution", "video_duration"], ["ai_name", "duration", "model_type", "resolution", "video_duration"]]);
    assert.deepEqual(quoteReads.map(({ duration, video_duration, resolution }) => [duration, video_duration, resolution]), [["0", "4", "1080P"], ["0", "4", "1080P"]]);
    const listedRecoveries = await client.callTool({ name: OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT } }); assert.equal(listedRecoveries.isError, undefined); assert.equal((listedRecoveries.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
    const reconciled = await client.callTool({ name: OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id } }); assert.equal(reconciled.isError, undefined); assert.equal(generations, 1);
    const page = await client.callTool({ name: OWNER_WAN27_R2V_GENERATION_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id } }); assert.equal(page.isError, undefined); assert.equal((page.structuredContent as { artifacts: unknown[] }).artifacts.length, 1); assert.equal(generations, 1);
    const revoked = await runtime.linkService.revoke(runtime.authBinding, ATTEMPT); assert.equal(revoked.status, "REVOKED");
    await assert.rejects(runtime.serverOptions.ownerWan27R2v!.generationService!.generate({ attemptId: ATTEMPT, request: { model_id: "wan_27_r2v", manifest_handle: manifest.manifest_handle, parameters: { resolution: "1080P", aspect_ratio: "16:9", video_duration: 4, prompt_extend: false, seed: null, native_audio: false } } }));
    const eofInput = new PassThrough(); assert.ok(runtime.ownerWan27R2vLifecycle);
    const closeEof = closeOwnerReadServicesOnTransportEof(st, runtime.ownerWan27R2vLifecycle, undefined, undefined, undefined, undefined, eofInput); eofInput.end(); await closeEof();
    await assert.rejects(runtime.serverOptions.ownerWan27R2v!.generationService!.listRecoveries({ attemptId: ATTEMPT }));
  } finally { await Promise.allSettled([client.close(), server.close(), runtime.ownerWan27R2vLifecycle?.close()]); }
});
