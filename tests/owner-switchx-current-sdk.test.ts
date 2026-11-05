import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { createOwnerSwitchxVideoRuntime } from "../src/runtime/owner-switchx-video-runtime.js";
import { registerSyntxOwnerSwitchxVideoTools } from "../src/mcp/owner-switchx-video-tools.js";

const ffmpeg = process.env.SYNTX_SWITCHX_TEST_FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.SYNTX_SWITCHX_TEST_FFPROBE ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
test("Switchx SDK all4 mask modes, style prompt, conditional1080,240frame segment and GET-only unknown recovery", { timeout: 60000 }, async (t) => {
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Trusted synthetic ffmpeg/ffprobe pair required"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-switchx-current-"));
  const makeVideo = async (name: string, geometry: string, rate: number, duration: number) => {
    const path = join(directory, name); execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=${geometry}:r=${rate}:d=${duration}`,
      "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", path]); return await readFile(path);
  };
  const foreground = await makeVideo("square1080.mp4", "1080x1080", 30, 3), highFrames = await makeVideo("highframes.mp4", "640x480", 60, 6);
  const imagePath = join(directory, "mask.png"); execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=white:s=640x480", "-frames:v", "1", "-y", imagePath]);
  const image = await readFile(imagePath); let now = Date.parse("2026-11-06T00:00:00Z");
  const binding = { tenant_id: "switchx-current", subject: "owner" }, attempt = "link_switchx_current_owner_012345678901";
  const store = new InMemoryAuthLinkStore(() => now), links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-switchx", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-switchx-only" }); return { state: "LINKED" }; }
  }, store, { now: () => now, defaultTtlMs: 30 * 60000, attemptIdGenerator: () => attempt });
  await links.createAttempt(binding); await links.issueHandoff(binding, attempt); await links.checkAttempt(binding, attempt);
  const bodies = new Map<string, any>(), uploads: any[] = [], quotes: any[] = []; let chats = 0, posts = 0, loseAck = false, denyCurrentAccess = false;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) return response({ balance: "1000" });
    if (url.pathname.endsWith("user/subscription")) return response({ active: true, type: "PRO", end_date: "2099-01-01" });
    if (url.pathname.endsWith("get_model_info")) { quotes.push(Object.fromEntries(url.searchParams)); return response({ access: !denyCurrentAccess, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("chats/upload-files")) {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); assert.equal(form.get("model_type"), "switchx");
      const uploaded = { filename: file.name, mime_type: file.type, size: file.size, status: "success", url: `https://r2.syntx.ai/switchx-current/input${uploads.length}` };
      uploads.push(uploaded); return response({ files: [uploaded] });
    }
    if (url.pathname === "/api/v1/chats" && init.method === "POST") return response({ uuid: `switchx-current-${++chats}` });
    if (url.pathname.endsWith("video/generate")) {
      const body = JSON.parse(String(init.body)); bodies.set(body.chat_id, body); posts++;
      if (loseAck) { loseAck = false; throw new Error("synthetic lost ACK"); } return response({ id: `owner-${body.chat_id}` });
    }
    if (url.pathname === "/api/v1/chats") return response({ chats: [...bodies.keys()].map(chat => ({ id: `provider-${chat}`, uuid: chat, scope: "video", title: "owner-switchx-video-00000000-0000-4000-8000-000000000001", created_at: "2026-11-06T00:00:00Z" })),
      pagination: { page: 1, page_size: 20, total_count: bodies.size, total_pages: 1, has_next: false, has_previous: false } });
    const route = url.pathname.match(/^\/api\/v1\/chats\/(switchx-current-\d+)\/(messages|owner-switchx-current-\d+|bot)$/u);
    if (route) {
      const chat = route[1]!, body = bodies.get(chat), owner = `owner-${chat}`;
      const ownerObjects = [{ id: "prompt", message_id: owner, object_type: "text", object_text: body.prompt, model_type: "switchx", completed: true },
        ...body.settings.file_urls.map((f: any, i: number) => ({ id: `input${i}`, message_id: owner, object_type: f.type, object_url: f.url, model_type: "switchx", completed: true }))];
      const botObjects = [0, 1].map(i => ({ id: `output${i}`, message_id: "bot", object_type: "video", object_url: `https://r2.syntx.ai/switchx-current/out${i}.mp4`, model_type: "switchx", completed: true }));
      const ownerRow = { id: owner, chat_id: `provider-${chat}`, author_id: 42, message_object: ownerObjects }, botRow = { id: "bot", chat_id: `provider-${chat}`, author_id: -1, message_object: botObjects };
      if (route[2] === "messages") return response({ messages: [ownerRow, botRow], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      return response(route[2] === "bot" ? botRow : ownerRow);
    }
    throw new Error("Unexpected synthetic Switchx route");
  };
  const broker = { async useCredential<T>(use: (value: string) => Promise<T>) { return await links.useCredential(binding, attempt, value => use(value.value)); } };
  const runtime = createOwnerSwitchxVideoRuntime({ binding, linkService: links, createReadClient: () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl }),
    createChatClient: () => new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl }), ffprobePath: ffprobe, ffmpegPath: ffmpeg, uploadDestination: "hidden", now: () => now });
  const server = new McpServer({ name: "switchx-current", version: "1" }); registerSyntxOwnerSwitchxVideoTools(server, { service: runtime.generationService });
  const [caller, host] = InMemoryTransport.createLinkedPair(), client = new Client({ name: "switchx-current", version: "1" }); await server.connect(host); await client.connect(caller);
  const tool = async (name: string, args: any) => await client.callTool({ name, arguments: { link_attempt_id: attempt, ...args } });
  const generate = async (args: any) => await tool("syntx_owner_generate_switchx_video", { filename: "foreground.mp4", mime_type: "video/mp4", content_base64: foreground.toString("base64"), prompt: "Refine supplied clip", ...args });
  try {
    const reference = async (role: string, data: Buffer, mime: string) => {
      const result = await tool("syntx_owner_upload_switchx_reference", { role, filename: role === "video_mask" ? "mask.mp4" : "mask.png", mime_type: mime, content_base64: data.toString("base64") });
      assert.notEqual(result.isError, true, JSON.stringify(result)); return (result.structuredContent as any).reference_handle;
    };
    const style = await reference("style_image", image, "image/png"), mask = await reference("image_mask", image, "image/png"), maskVideo = await reference("video_mask", foreground, "video/mp4");
    const otherBinding = { tenant_id: "switchx-current-other-owner", subject: "owner-two" }, otherStore = new InMemoryAuthLinkStore(() => now);
    const otherLinks = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
      async createChallenge() { return { upstream_attempt_id: "synthetic-other", approval_url: "https://example.invalid/approve" }; },
      async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-other-only" }); return { state: "LINKED" }; }
    }, otherStore, { now: () => now, defaultTtlMs: 30 * 60000, attemptIdGenerator: () => attempt });
    await otherLinks.createAttempt(otherBinding); await otherLinks.issueHandoff(otherBinding, attempt); await otherLinks.checkAttempt(otherBinding, attempt);
    const otherRuntime = createOwnerSwitchxVideoRuntime({ binding: otherBinding, linkService: otherLinks,
      createReadClient: () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), createChatClient: () => new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl }),
      ffprobePath: ffprobe, uploadDestination: "hidden", now: () => now });
    try { await assert.rejects(otherRuntime.generationService.generate({ attemptId: attempt, filename: "foreground.mp4", mime_type: "video/mp4",
      content_base64: foreground.toString("base64"), prompt: "Other independently linked owner cannot borrow handle", mask_mode: "image", mask_handle: mask })); }
    finally { await otherRuntime.lifecycle.close(); otherStore.close(); }

    for (const args of [{ mask_mode: "image" }, { mask_mode: "fill", mask_handle: mask }, { mask_mode: "video", mask_handle: mask }, { mask_mode: "image", mask_handle: style }, { prompt: "" }, { mask_mode: "auto", resolution: "1080P", content_base64: highFrames.toString("base64") }]) {
      const invalid = await generate(args); assert.equal(invalid.isError, true, JSON.stringify(invalid));
    }
    assert.equal(posts, 0); assert.equal(chats, 0); assert.equal(quotes.length, 0);
    const forged = await generate({ mask_mode: "image", mask_handle: "switchx_reference_00000000-0000-4000-8000-000000000000" }); assert.equal(forged.isError, true);
    const wrongAttempt = await generate({ link_attempt_id: "link_switchx_foreign_owner_012345678901", mask_mode: "image", mask_handle: mask }); assert.equal(wrongAttempt.isError, true);
    denyCurrentAccess = true;
    const denied = await generate({ prompt: "Current access denied must not dispatch", resolution: "1080P" }); assert.equal(denied.isError, true); assert.equal(posts, 0); assert.equal(chats, 0);
    denyCurrentAccess = false;
    for (const mask_mode of ["auto", "fill"]) { const generated = await generate({ mask_mode, resolution: "1080P" }); assert.notEqual(generated.isError, true, JSON.stringify(generated)); }
    const painted = await generate({ mask_mode: "image", mask_handle: mask, style_image_handle: style, resolution: "1080P", prompt: "" });
    assert.notEqual(painted.isError, true, JSON.stringify(painted)); assert.match((painted.structuredContent as any).source_binding.public_catalog_version, /a82998/u); assert.deepEqual(bodies.get("switchx-current-3").settings.file_urls.map((f: any) => f.type), ["video", "image", "mask"]);
    const highFrameDenied = await generate({ content_base64: highFrames.toString("base64"), mask_mode: "video", mask_handle: maskVideo }); assert.equal(highFrameDenied.isError, true);
    loseAck = true;
    const videoArgs = { content_base64: highFrames.toString("base64"), mask_mode: "video", mask_handle: maskVideo, segment: { start_seconds: 2, end_seconds: 5 } };
    const lost = await generate(videoArgs); assert.equal(lost.isError, true); const error = JSON.parse((lost.content as any)[0].text).error; assert.equal(error.code, "OUTCOME_UNKNOWN");
    const body = bodies.get("switchx-current-4").settings; assert.equal(body.video_duration, 3); assert.equal(body.frame_rate, 60); assert.equal(body.mask_mode, "video");
    assert.deepEqual(body.file_urls.map((f: any) => f.type), ["video", "mask"]);
    const recovered = await tool("syntx_owner_reconcile_switchx_video", { recovery_id: error.recovery_id }); assert.notEqual(recovered.isError, true, JSON.stringify(recovered)); assert.equal(posts, 4);
    const replay = await generate(videoArgs); assert.equal(replay.isError, true); assert.equal(posts, 4); assert.equal(quotes.length, 9);
    assert.equal(quotes.at(-1).video_duration, "3"); assert.equal(quotes.at(-1).frame_rate, "60");
    now += 15 * 60000 + 1; const expired = await generate({ mask_mode: "image", mask_handle: mask, prompt: "Expired handle" }); assert.equal(expired.isError, true); assert.equal(posts, 4);
  } finally { await client.close(); await server.close(); await runtime.lifecycle.close(); store.close(); foreground.fill(0); highFrames.fill(0); image.fill(0); await rm(directory, { recursive: true, force: true }); }
});
