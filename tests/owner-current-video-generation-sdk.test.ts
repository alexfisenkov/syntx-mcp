import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthLinkStore } from "../src/auth/auth-link-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OwnerCurrentVideoGenerationService } from "../src/application/owner-current-video-generation-service.js";
import { getOwnerHailuo3CurrentFamilyDefinition } from "../src/application/owner-hailuo3-current-intent.js";

const ATTEMPT = "link_current_family_sdk_owner_012345678901";
let fixtureCount = 0;
function png(index: number): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(640 + index, 16); bytes.writeUInt32BE(640, 20); let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29); return bytes;
}
async function fixture(ffprobePath = join(process.cwd(), "unused-binary-for-structural-png")) {
  const binding = { tenant_id: `current-family-sdk-${++fixtureCount}`, subject: "owner" };
  let now = Date.parse("2026-11-06T00:00:00Z"), linked = true, denied = false, loseAck = false;
  let rejectPost = false, invalidAck = false, failHistory = false;
  let echo: "normal" | "missing" | "swapped" | "foreign-author" = "normal";
  const counters = { uploads: 0, chats: 0, posts: 0, account: 0, quotes: 0, history: 0, results: 0 };
  const uploaded: { url: string; model: string }[] = [], bodies: any[] = [], queries: Record<string, string>[] = [];
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET"; assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("chats/upload-files")) {
      counters.uploads++; events.push("upload"); const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      const record = { url: `https://r2.syntx.ai/current-sdk/${binding.tenant_id}/input${uploaded.length}.png`, model: String(form.get("model_type")) }; uploaded.push(record);
      return Response.json({ files: [{ url: record.url, filename: file.name, content_type: file.type, size: file.size, status: "success" }] });
    }
    if (url.pathname.endsWith("user/balance")) { counters.account++; events.push("balance"); return Response.json({ balance: "1000" }); }
    if (url.pathname.endsWith("user/subscription")) return Response.json({ active: true, type: "PRO", end_date: "2099-01-01" });
    if (url.pathname.endsWith("get_model_info")) { counters.quotes++; events.push("quote"); queries.push(Object.fromEntries(url.searchParams)); return Response.json({ access: !denied,
      cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") { counters.chats++; events.push("chat"); return Response.json({ uuid: `current-sdk-chat-${counters.chats}` }); }
    if (url.pathname.endsWith("video/generate") && method === "POST") {
      counters.posts++; events.push("post"); const body = JSON.parse(String(init.body)); bodies.push(body); assert.ok(body.settings.model_type); assert.ok(Array.isArray(body.settings.file_urls));
      if (rejectPost) { rejectPost = false; return new Response("private upstream body", { status: 400 }); }
      if (invalidAck) { invalidAck = false; return Response.json({}); }
      if (loseAck) { loseAck = false; throw new Error("synthetic unknown generation ACK"); } return Response.json({ id: `owner-${body.chat_id}` });
    }
    const route = url.pathname.match(/^\/api\/v1\/chats\/(current-sdk-chat-\d+)\/(messages|bot-current-sdk-chat-\d+)$/u);
    if (route) {
      const chat = route[1]!, body = bodies.find(item => item.chat_id === chat); assert.ok(body);
      const ownerId = `owner-${chat}`, botId = `bot-${chat}`, model = body.settings.model_type;
      const media = body.settings.file_urls.map((file: { type: string; url: string }, index: number) => ({ id: `input-${index}`, message_id: ownerId,
        object_type: ["first_frame", "last_frame"].includes(file.type) ? "image" : file.type, object_url: file.url, model_type: model }));
      if (echo === "missing") media.pop(); if (echo === "swapped") media.reverse();
      const owner = { id: ownerId, chat_id: 100, author_id: echo === "foreign-author" ? -2 : 42, message_object: [
        ...(body.prompt ? [{ id: "text", message_id: ownerId, object_type: "text", object_text: body.prompt, model_type: model }] : []), ...media] };
      const bot = { id: botId, chat_id: 100, author_id: -1, message_object: [{ id: `output-${chat}`, message_id: botId, object_type: "video", model_type: model }] };
      if (route[2] === "messages") { counters.history++; if (failHistory) { failHistory = false; throw new Error("private history failure"); } return Response.json({ messages: [owner, bot], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } }); }
      counters.results++; return Response.json({ ...bot, message_object: [{ ...bot.message_object[0], completed: true, object_url: `https://r2.syntx.ai/current-sdk/${chat}.mp4` }] });
    }
    throw new Error("Unexpected synthetic current-family route");
  };
  const authStore = { async getSnapshot(_binding: unknown, attempt: string) { return { attempt_id: attempt, authorization_profile: OBSERVED_AUTHORIZATION_PROFILE,
    status: linked ? "LINKED" : "UNLINKED", expires_at: null, linked }; },
    async useCredential<T>(_binding: unknown, _attempt: unknown, use: (credential: { scheme: "Bearer"; value: string }) => T | Promise<T>) {
      if (!linked) throw new Error("synthetic unlinked"); return await use({ scheme: "Bearer", value: "synthetic-current-family-only" }); }
  } as unknown as AuthLinkStore;
  const runtime = createObservedOwnerRuntime({ authBinding: binding, authStore, ownerCurrentVideoReferencesEnabled: true,
    ownerCurrentVideoFfprobePath: ffprobePath, fetchImpl, now: () => now });
  const server = createMcpServer(runtime.application, runtime.serverOptions), client = new Client({ name: "current-family-sdk", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair(); await server.connect(host); await client.connect(caller);
  const tool = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: { link_attempt_id: ATTEMPT, ...args } });
  const uploadBytes = async (model: string, filename: string, mime_type: string, bytes: Buffer) => {
    const result = await tool("syntx_owner_upload_current_video_reference", { model_id: model, filename, mime_type, content_base64: bytes.toString("base64") });
    assert.notEqual(result.isError, true, JSON.stringify(result)); return (result.structuredContent as { reference_handle: string }).reference_handle;
  };
  const upload = async (model: string, index: number) => await uploadBytes(model, `reference${index}.png`, "image/png", png(index));
  return { runtime, client, tool, upload, uploadBytes, counters, bodies, queries, events, binding,
    setDenied(value: boolean) { denied = value; }, setRejectedPost() { rejectPost = true; }, setFailHistory() { failHistory = true; }, setInvalidAck() { invalidAck = true; }, setLostAck() { loseAck = true; }, setEcho(value: typeof echo) { echo = value; }, unlink() { linked = false; }, relink() { linked = true; },
    advance() { now += 16 * 60000; }, async close() { await client.close(); await server.close(); await runtime.ownerCurrentVideoLifecycle?.close(); } };
}
function contentError(result: any) { return JSON.parse(result.content[0].text).error; }
test("current-family actual SDK uses shared native port, both account gates, source typed wire and all3family modes", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const tools = (await f.client.listTools()).tools;
    assert.ok(tools.find(tool => tool.name === "syntx_owner_generate_hailuo3_current")?.inputSchema.properties?.mode);
    assert.ok(tools.find(tool => tool.name === "syntx_owner_generate_luma_current")?.inputSchema.properties?.quality);
    assert.ok(tools.find(tool => tool.name === "syntx_owner_generate_veo3_current")?.inputSchema.properties?.upscale);
    const last = await f.upload("hailuo-3.0", 1), h = await f.tool("syntx_owner_generate_hailuo3_current", { mode: "frames", resolution: "768p", video_duration: 5.375,
      aspect_ratio: "auto", prompt: "A quiet @image1 last-only scene", references: [{ reference_handle: last, role: "last_frame" }] });
    assert.notEqual(h.isError, true, JSON.stringify(h)); assert.equal((h.structuredContent as any).status, "completed");
    assert.deepEqual((h.content as CallToolResult["content"]).filter(block => block.type === "resource_link"), [{ type: "resource_link", uri: "https://r2.syntx.ai/current-sdk/current-sdk-chat-1.mp4", name: "video-1", mimeType: "video/mp4" }]);
    assert.equal(((h.content as CallToolResult["content"])[0] as { text: string }).text, JSON.stringify(h.structuredContent));
    assert.deepEqual(f.bodies[0].settings.file_urls.map((file: any) => file.type), ["last_frame"]);
    assert.equal(f.bodies[0].prompt, "A quiet @image1 last-only scene");
    assert.equal(f.queries[0]!.ref_count, "1"); assert.equal(f.queries[0]!.duration, "0"); assert.equal(f.queries[0]!.video_duration, "5.375");
    assert.equal(f.bodies[0].settings.video_duration, 5.375);
    const lumaRefs = [await f.upload("ray-3.14", 2), await f.upload("ray-3.14", 3)].map(reference_handle => ({ reference_handle, role: "image" }));
    const luma = await f.tool("syntx_owner_generate_luma_current", { references: lumaRefs, prompt: "", quality: "1080p", video_duration: 5, aspect_ratio: "auto" });
    assert.notEqual(luma.isError, true, JSON.stringify(luma)); assert.equal((luma.structuredContent as any).status, "completed");
    assert.equal(f.bodies[1].settings.gen_type, "keyframes"); assert.equal(f.bodies[1].prompt, ""); assert.equal(f.bodies[1].settings.file_urls.length, 2);
    // The same uploaded handles support another explicit intent; only the one-shot bundle is consumed.
    const aliases = await f.tool("syntx_owner_generate_luma_current", { references: lumaRefs, prompt: "Move from @image1 to @image2 while keeping @image99 literal", quality: "720p", video_duration: 5, aspect_ratio: "auto" });
    assert.notEqual(aliases.isError, true, JSON.stringify(aliases)); assert.match(f.bodies[2].prompt, /<<<https:\/\/r2\.syntx\.ai\//u); assert.equal(f.bodies[2].prompt.includes("@image99"), true); assert.equal(f.counters.uploads, 3);
    const veoRefs = [await f.upload("veo3fast_r", 4), await f.upload("veo3fast_r", 5), await f.upload("veo3fast_r", 6)].map(reference_handle => ({ reference_handle, role: "image" }));
    const prefix = "Veo @image1 ", longPrompt = prefix + "é".repeat(50000 - prefix.length);
    const veoArgs = { model_id: "veo3fast_r", type: "references", references: veoRefs, prompt: longPrompt, aspect_ratio: "9:16", video_duration: 8, upscale: 2 };
    const veo = await f.tool("syntx_owner_generate_veo3_current", veoArgs); assert.notEqual(veo.isError, true, JSON.stringify(veo));
    assert.equal((veo.structuredContent as any).status, "completed"); assert.equal(f.bodies[3].prompt.length, 50000); assert.equal(f.bodies[3].prompt.startsWith(prefix), true); assert.equal(f.bodies[3].settings.aspect_ratio, "9:16");
    assert.equal(f.queries.at(-1)!.upscale, "2"); assert.deepEqual(Object.keys(f.queries.at(-1)!).sort(), ["ai_name", "model_type", "upscale"]);
    const omni = await f.tool("syntx_owner_generate_hailuo3_current", { prompt: "A separate text-only omni source scene", mode: "omni-references", resolution: "2K", video_duration: 15, aspect_ratio: "21:9", references: [] });
    assert.notEqual(omni.isError, true, JSON.stringify(omni)); assert.deepEqual(f.bodies.at(-1).settings.file_urls, []);
    const textLuma = await f.tool("syntx_owner_generate_luma_current", { prompt: "A separate text-only Luma scene", quality: "360p", video_duration: 10, aspect_ratio: "21:9", references: [] });
    assert.notEqual(textLuma.isError, true, JSON.stringify(textLuma)); assert.equal(f.bodies.at(-1).settings.gen_type, "text2video");
    const baseVeoRefs = [await f.upload("veo3", 7), await f.upload("veo3", 8)].map(reference_handle => ({ reference_handle, role: "image" }));
    const imageVeo = await f.tool("syntx_owner_generate_veo3_current", { model_id: "veo3", type: "image", references: baseVeoRefs, prompt: "A base Veo two-image scene", aspect_ratio: "16:9", video_duration: 8, upscale: 1 });
    assert.notEqual(imageVeo.isError, true, JSON.stringify(imageVeo)); assert.equal(f.bodies.at(-1).settings.file_urls.length, 2);
    const textVeo = await f.tool("syntx_owner_generate_veo3_current", { model_id: "veo3fast", type: "text", references: [], prompt: "A separate text-only fast Veo scene", aspect_ratio: "9:16", video_duration: 8, upscale: 0 });
    assert.notEqual(textVeo.isError, true, JSON.stringify(textVeo)); assert.equal(f.bodies.at(-1).settings.type, "text");
    assert.equal(f.counters.posts, 8); assert.equal(f.counters.quotes, 16); assert.equal(f.counters.account, 16);
    for (let index = 0; index < f.events.length; index++) if (f.events[index] === "chat") assert.equal(f.events[index - 1], "quote");
    for (let index = 0; index < f.events.length; index++) if (f.events[index] === "post") assert.equal(f.events[index - 1], "quote");
    f.setLostAck(); const unknownArgs = { ...veoArgs, prompt: "A distinct unknown current reference operation" };
    const unknown = await f.tool("syntx_owner_generate_veo3_current", unknownArgs); assert.equal(unknown.isError, true); const error = contentError(unknown); assert.equal(error.code, "OUTCOME_UNKNOWN");
    const before = { ...f.counters }; f.setEcho("missing");
    const missing = await f.tool("syntx_owner_get_veo3_current_result", { recovery_id: error.recovery_id }); assert.equal((missing.structuredContent as any).status, "unverified");
    f.setEcho("foreign-author"); const foreign = await f.tool("syntx_owner_get_veo3_current_result", { recovery_id: error.recovery_id }); assert.equal((foreign.structuredContent as any).status, "unverified");
    f.advance(); f.setEcho("normal"); const recovered = await f.tool("syntx_owner_get_veo3_current_result", { recovery_id: error.recovery_id });
    assert.notEqual(recovered.isError, true, JSON.stringify(recovered)); assert.equal((recovered.structuredContent as any).status, "completed");
    assert.equal(f.counters.posts, before.posts); assert.equal(f.counters.quotes, before.quotes); assert.equal(f.counters.uploads, before.uploads);
    const replay = await f.tool("syntx_owner_generate_veo3_current", unknownArgs); assert.equal(replay.isError, true); assert.equal(f.counters.posts, 9);
    await f.runtime.ownerCurrentVideoLifecycle!.invalidateAttempt(ATTEMPT);
    const newAttempt = "link_current_family_relinked_owner_0123456789", freshRefs = [];
    for (const index of [4, 5, 6]) { const uploaded = await f.tool("syntx_owner_upload_current_video_reference", { link_attempt_id: newAttempt, model_id: "veo3fast_r",
      filename: `reference${index}.png`, mime_type: "image/png", content_base64: png(index).toString("base64") }); assert.notEqual(uploaded.isError, true, JSON.stringify(uploaded));
      freshRefs.push({ reference_handle: (uploaded.structuredContent as any).reference_handle, role: "image" }); }
    const relinkReplay = await f.tool("syntx_owner_generate_veo3_current", { ...unknownArgs, link_attempt_id: newAttempt, references: freshRefs });
    assert.equal(relinkReplay.isError, true); assert.equal(contentError(relinkReplay).code, "INTENT_ALREADY_CLAIMED"); assert.equal(f.counters.posts, 9);
  } finally { await f.close(); }
});

test("Veo Omni Flash 1.2 has a separate pinned SDK tool and text quote without a reference mode", async () => {
  const f = await fixture();
  try {
    const names = (await f.client.listTools()).tools.map(tool => tool.name);
    for (const name of ["syntx_owner_get_veo_omni12_current_source", "syntx_owner_generate_veo_omni12_current",
      "syntx_owner_get_veo_omni12_current_result", "syntx_owner_list_veo_omni12_current_recoveries"]) assert.ok(names.includes(name));
    const source = await f.client.callTool({ name: "syntx_owner_get_veo_omni12_current_source", arguments: {} });
    assert.equal((source.structuredContent as any).source.model_id, "omni1.2");
    const args = { model_id: "omni1.2", type: "text", prompt: "A separate pinned Omni twelve scene",
      aspect_ratio: "16:9", video_duration: 3, upscale: 3, references: [] };
    const result = await f.tool("syntx_owner_generate_veo_omni12_current", args);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal((result.structuredContent as any).status, "completed");
    assert.deepEqual(Object.keys(f.queries[0]!).sort(), ["ai_name", "model_type", "upscale", "video_duration"]);
    assert.equal(f.queries[0]!.model_type, "omni1.2");
    assert.equal(f.bodies[0]!.settings.model_type, "omni1.2");
    assert.deepEqual(f.bodies[0]!.settings.file_urls, []);
    const wrongModel = await f.tool("syntx_owner_generate_veo_omni12_current", { ...args, model_id: "veo_omni", prompt: "A wrong model cannot cross the binding" });
    assert.equal(wrongModel.isError, true); assert.equal(f.counters.posts, 1);
    f.setLostAck();
    const unknown = await f.tool("syntx_owner_generate_veo_omni12_current", { ...args, prompt: "A second Omni twelve uncertain scene" });
    assert.equal(contentError(unknown).code, "OUTCOME_UNKNOWN");
    const before = { ...f.counters };
    const recovered = await f.tool("syntx_owner_get_veo_omni12_current_result", { recovery_id: contentError(unknown).recovery_id });
    assert.equal((recovered.structuredContent as any).status, "completed");
    assert.equal(f.counters.posts, before.posts); assert.equal(f.counters.quotes, before.quotes);
  } finally { await f.close(); }
});

test("Veo Omni Flash 1.2 routes frames, first clip and mixed references to exact quote branches", { timeout: 30000 }, async t => {
  const ffmpeg = process.env.SYNTX_CURRENT_VIDEO_TEST_FFMPEG ?? "/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffmpeg";
  const ffprobe = process.env.SYNTX_CURRENT_VIDEO_TEST_FFPROBE ?? "/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffprobe";
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Trusted current codec pair required"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-omni12-mixed-")), videoPath = join(directory, "clip.mp4");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=16:d=4",
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", videoPath]);
  const video = await readFile(videoPath), f = await fixture(ffprobe);
  try {
    const first = await f.upload("omni1.2", 1), last = await f.upload("omni1.2", 2);
    const frame = await f.tool("syntx_owner_generate_veo_omni12_current", { model_id: "omni1.2", type: "image",
      prompt: "A deliberate two-frame Omni twelve scene", aspect_ratio: "16:9", video_duration: 10, upscale: 1,
      references: [{ reference_handle: first, role: "first_frame" }, { reference_handle: last, role: "last_frame" }] });
    assert.notEqual(frame.isError, true, JSON.stringify(frame));
    assert.deepEqual(Object.keys(f.queries[0]!).sort(), ["ai_name", "model_type", "upscale", "video_duration"]);
    assert.deepEqual(f.bodies[0]!.settings.file_urls.map((file: any) => file.type), ["first_frame", "last_frame"]);
    const clip = await f.uploadBytes("omni1.2", "clip.mp4", "video/mp4", video);
    const extend = await f.tool("syntx_owner_generate_veo_omni12_current", { model_id: "omni1.2", type: "image",
      prompt: "Continue the supplied Omni twelve clip", aspect_ratio: "9:16", video_duration: 6, upscale: 0,
      references: [{ reference_handle: clip, role: "first_clip" }] });
    assert.notEqual(extend.isError, true, JSON.stringify(extend));
    assert.equal(f.queries[2]!.veo3_type, "extend"); assert.equal(f.queries[3]!.veo3_type, "extend");
    assert.equal(f.queries[2]!.mode, undefined);
    const mixed = await f.tool("syntx_owner_generate_veo_omni12_current", { model_id: "omni1.2", type: "references",
      prompt: "A mixed reference Omni twelve scene", aspect_ratio: "9:16", video_duration: 15, upscale: 2,
      references: [{ reference_handle: first, role: "image" }, { reference_handle: clip, role: "video" }] });
    assert.notEqual(mixed.isError, true, JSON.stringify(mixed));
    assert.equal(f.queries[4]!.mode, "full"); assert.equal(f.queries[5]!.mode, "full");
    assert.equal(f.queries[4]!.veo3_type, undefined);
    assert.equal(f.counters.posts, 3); assert.equal(f.counters.quotes, 6);
    const invalid = await f.tool("syntx_owner_generate_veo_omni12_current", { model_id: "omni1.2", type: "image",
      prompt: "A forbidden long two-frame output", aspect_ratio: "16:9", video_duration: 11, upscale: 1,
      references: [{ reference_handle: first, role: "first_frame" }, { reference_handle: last, role: "last_frame" }] });
    assert.equal(invalid.isError, true); assert.equal(f.counters.posts, 3); assert.equal(f.counters.quotes, 6);
  } finally { await f.close(); video.fill(0); await rm(directory, { recursive: true, force: true }); }
});
test("current shared app denies source forgery, foreign handles, invalid modes and live access before generation", async () => {
  const f = await fixture(), other = await fixture();
  try {
    const handle = await f.upload("hailuo-3.0", 1);
    const args = { mode: "frames", resolution: "768p", video_duration: 5, aspect_ratio: "auto", prompt: "A quiet foreign denial", references: [{ reference_handle: handle, role: "last_frame" }] };
    const foreign = await other.tool("syntx_owner_generate_hailuo3_current", args); assert.equal(foreign.isError, true); assert.equal(other.counters.quotes, 0); assert.equal(other.counters.posts, 0);
    const invalid = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, aspect_ratio: "16:9" }); assert.equal(invalid.isError, true); assert.equal(f.counters.quotes, 0);
    const baseVeo = await f.tool("syntx_owner_generate_veo3_current", { model_id: "veo3", type: "references", prompt: "A legitimate scene", aspect_ratio: "16:9", video_duration: 8, upscale: 0, references: [] });
    assert.equal(baseVeo.isError, true); assert.equal(f.counters.posts, 0);
    const rawMarker = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, prompt: "A raw <<<https://r2.syntx.ai/unowned.png>>> marker" });
    assert.equal(rawMarker.isError, true); assert.equal(contentError(rawMarker).code, "INVALID_REQUEST");
    assert.equal(f.counters.quotes, 0); assert.equal(f.counters.chats, 0); assert.equal(f.counters.posts, 0);
    f.setDenied(true); const denied = await f.tool("syntx_owner_generate_hailuo3_current", args); assert.equal(denied.isError, true); assert.equal(f.counters.posts, 0); assert.equal(f.counters.chats, 0);
    const definition = getOwnerHailuo3CurrentFamilyDefinition();
    assert.throws(() => new OwnerCurrentVideoGenerationService({ binding: f.binding, linkService: {} as never, references: {} as never, native: {} as never,
      createReadClient: () => null as never, family: { ...definition } }), { code: "SOURCE_BINDING_MISMATCH" });
  } finally { await f.close(); await other.close(); }
});

test("current Hailuo SDK genuinely probes mixed audio and video without inheriting image-side or FPS bounds", { timeout: 30000 }, async t => {
  const ffmpeg = process.env.SYNTX_CURRENT_VIDEO_TEST_FFMPEG ?? "/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffmpeg";
  const ffprobe = process.env.SYNTX_CURRENT_VIDEO_TEST_FFPROBE ?? "/opt/homebrew/Cellar/ffmpeg/9.0.2_1/bin/ffprobe";
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Trusted current codec pair required"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-current-hailuo-mixed-")), videoPath = join(directory, "video.mp4"), audioPath = join(directory, "audio.wav");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=8:d=2.125", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", videoPath]);
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=2", "-c:a", "pcm_s16le", "-y", audioPath]);
  const video = await readFile(videoPath), audio = await readFile(audioPath), f = await fixture(ffprobe);
  try {
    const handles = [await f.upload("hailuo-3.0", 1), await f.uploadBytes("hailuo-3.0", "video.mp4", "video/mp4", video), await f.uploadBytes("hailuo-3.0", "audio.wav", "audio/wav", audio)];
    const result = await f.tool("syntx_owner_generate_hailuo3_current", { mode: "omni-references", resolution: "768p", video_duration: 15, aspect_ratio: "4:3",
      prompt: "Preserve motion and use the supplied sound with the portrait", references: handles.map((reference_handle, index) => ({ reference_handle, role: ["image", "video", "audio"][index] })) });
    assert.notEqual(result.isError, true, JSON.stringify(result)); assert.equal((result.structuredContent as any).status, "completed");
    assert.deepEqual(f.bodies[0].settings.file_urls.map((file: any) => file.type), ["image", "video", "audio"]);
    assert.equal(f.queries[0]!.duration, "2.13"); assert.equal(f.queries[0]!.ref_count, "1"); assert.equal(f.counters.posts, 1); assert.equal(f.counters.quotes, 2);
  } finally { await f.close(); video.fill(0); audio.fill(0); await rm(directory, { recursive: true, force: true }); }
});


test("current video recovery exposes only bounded observed dispatch diagnostics", async () => {
  const f = await fixture();
  const args = { mode: "omni-references", resolution: "768p", video_duration: 5, aspect_ratio: "16:9", references: [] };
  try {
    f.setRejectedPost();
    const rejected = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, prompt: "Distinct rejected diagnostic scene" });
    assert.equal(contentError(rejected).code, "OUTCOME_UNKNOWN");
    const rejectedId = contentError(rejected).recovery_id;
    f.setFailHistory();
    const failedHistory = await f.tool("syntx_owner_get_hailuo3_current_result", { recovery_id: rejectedId });
    assert.equal((failedHistory.structuredContent as any).status, "unverified");
    assert.deepEqual((failedHistory.structuredContent as any).diagnostic, { category: "HTTP_REJECTED", http_status: 400 });
    assert.equal(JSON.stringify(failedHistory).includes("private history failure"), false);
    const rejectedResult = await f.tool("syntx_owner_get_hailuo3_current_result", { recovery_id: rejectedId });
    assert.deepEqual((rejectedResult.structuredContent as any).diagnostic, { category: "HTTP_REJECTED", http_status: 400 });
    assert.equal(JSON.stringify(rejectedResult).includes("private upstream body"), false);
    f.setLostAck();
    const lost = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, prompt: "Distinct lost diagnostic scene" });
    assert.equal(contentError(lost).code, "OUTCOME_UNKNOWN");
    const lostResult = await f.tool("syntx_owner_get_hailuo3_current_result", { recovery_id: contentError(lost).recovery_id });
    assert.deepEqual((lostResult.structuredContent as any).diagnostic, { category: "TRANSPORT_UNVERIFIED" });
    const foreign = await f.tool("syntx_owner_get_hailuo3_current_result", { link_attempt_id: "link_current_family_foreign_012345678901", recovery_id: rejectedId });
    assert.equal(foreign.isError, true); assert.equal(JSON.stringify(foreign).includes("HTTP_REJECTED"), false);
    f.setInvalidAck();
    const invalidAck = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, prompt: "Distinct malformed ack diagnostic scene" });
    assert.equal(contentError(invalidAck).code, "OUTCOME_UNKNOWN");
    const ackResult = await f.tool("syntx_owner_get_hailuo3_current_result", { recovery_id: contentError(invalidAck).recovery_id });
    assert.deepEqual((ackResult.structuredContent as any).diagnostic, { category: "ACK_UNVERIFIED", http_status: 200 });
    const good = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, prompt: "Distinct successful diagnostic scene" });
    assert.equal((good.structuredContent as any).status, "completed");
    assert.equal(Object.hasOwn(good.structuredContent as object, "diagnostic"), false);
    assert.equal(f.counters.posts, 4);
    const replay = await f.tool("syntx_owner_generate_hailuo3_current", { ...args, prompt: "Distinct rejected diagnostic scene" });
    assert.equal(replay.isError, true); assert.equal(f.counters.posts, 4);
  } finally { await f.close(); }
});
