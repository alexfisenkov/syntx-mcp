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
import { createOwnerHappyHorseRuntime } from "../src/runtime/owner-happy-horse-runtime.js";
import { registerSyntxOwnerHappyHorseTools } from "../src/mcp/owner-happy-horse-tools.js";

const ffmpeg = process.env.SYNTX_HAPPY_HORSE_TEST_FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.SYNTX_HAPPY_HORSE_TEST_FFPROBE ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function png(index: number): Buffer {
  const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  data.writeUInt32BE(640 + index, 16); data.writeUInt32BE(640, 20);
  let crc = 0xffffffff; for (const byte of data.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  data.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29); return data;
}
test("HappyHorse SDK current references9 and editvideo55s plus2images bind exact controls/derived quote; unknown POST recovers by GET only", { timeout: 30000 }, async (t) => {
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Synthetic codec fixtures require trusted ffmpeg/ffprobe"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-happy-current-sdk-")), path = join(directory, "edit55.mp4");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x480:r=24:d=55", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", path]);
  const videoBytes = await readFile(path), now = Date.parse("2026-11-06T00:00:00Z"), attempt = "link_happy_current_owner_012345678901";
  const binding = { tenant_id: "happy-current", subject: "owner" }, store = new InMemoryAuthLinkStore(() => now);
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-happy", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-happy-only" }); return { state: "LINKED" }; }
  }, store, { now: () => now, defaultTtlMs: 30 * 60000, attemptIdGenerator: () => attempt });
  await links.createAttempt(binding); await links.issueHandoff(binding, attempt); await links.checkAttempt(binding, attempt);
  let uploadCount = 0, posts = 0, chats = 0, quotes = 0, loseAck = false;
  const bodies = new Map<string, { chat_id: string; prompt: string; settings: Record<string, any> }>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) return response({ balance: "1000" });
    if (url.pathname.endsWith("user/subscription")) return response({ active: true, type: "PRO", end_date: "2099-01-01" });
    if (url.pathname.endsWith("get_model_info")) {
      quotes++; const model = url.searchParams.get("model_type"); assert.equal(url.searchParams.get("resolution"), "1080P");
      assert.equal(url.searchParams.get("video_duration"), model === "happy_horse_edit" ? "15" : "6.5");
      return response({ access: true, cost: 1, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); uploadCount++;
      return response({ files: [{ url: `https://r2.syntx.ai/happy-current-sdk/upload-${uploadCount}`, filename: file.name, mime_type: file.type,
        media_type: file.type.startsWith("image/") ? "image" : "video", type: file.type.startsWith("image/") ? "image" : "video", size: file.size, status: "success" }] });
    }
    if (url.pathname === "/api/v1/chats") { chats++; return response({ uuid: `happy-current-chat-${chats}` }); }
    if (url.pathname.endsWith("video/generate")) {
      posts++; const body = JSON.parse(String(init.body)); bodies.set(body.chat_id, body);
      if (loseAck) { loseAck = false; throw new Error("synthetic possible accepted POST"); }
      return response({ id: `owner-${body.chat_id}` });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(happy-current-chat-\d+)\/messages$/u);
    const detail = url.pathname.match(/^\/api\/v1\/chats\/(happy-current-chat-\d+)\/bot$/u);
    const chat = history?.[1] ?? detail?.[1];
    if (chat) {
      const body = bodies.get(chat)!;
      const bot = { id: "bot", chat_id: `provider-${chat}`, author_id: -1, message_object: [{ id: "output", message_id: "bot", object_type: "video", object_url: "https://r2.syntx.ai/happy-current-sdk/output.mp4", model_type: body.settings.model_type, completed: true }] };
      if (detail) return response(bot);
      return response({ messages: [{ id: `owner-${chat}`, chat_id: `provider-${chat}`, author_id: 42, message_object: [
        { id: "prompt", message_id: `owner-${chat}`, object_type: "text", object_text: body.prompt },
        ...body.settings.file_urls.map((file: { type: string; url: string }, i: number) => ({ id: `input-${i}`, message_id: `owner-${chat}`, object_type: file.type === "video" ? "video" : "image", object_url: file.url }))
      ] }, bot], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    throw new Error("Unexpected synthetic current HappyHorse route");
  };
  const broker = { async useCredential<T>(use: (value: string) => Promise<T>) { return await links.useCredential(binding, attempt, (credential) => use(credential.value)); } };
  const runtime = createOwnerHappyHorseRuntime({ binding, linkService: links, createReadClient: () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl }),
    createChatClient: () => new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl }), ffprobePath: ffprobe, uploadDestination: "hidden", now: () => now });
  const server = new McpServer({ name: "happy-current", version: "1" }); registerSyntxOwnerHappyHorseTools(server, { referenceService: runtime.referenceService, editVideoReferenceService: runtime.editVideoReferenceService, generationService: runtime.generationService });
  const [caller, host] = InMemoryTransport.createLinkedPair(), client = new Client({ name: "happy-current", version: "1" });
  await server.connect(host); await client.connect(caller);
  const tool = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: { link_attempt_id: attempt, ...args } });
  try {
    const images = async (model: string, count: number) => {
      const handles: string[] = [];
      for (let i = 0; i < count; i++) { const result = await tool("syntx_owner_upload_happy_horse_image", { model_id: model, filename: `reference${i}.png`, mime_type: "image/png", content_base64: png(i).toString("base64") });
        assert.notEqual(result.isError, true, JSON.stringify(result)); handles.push((result.structuredContent as any).reference_handle); }
      return handles;
    };
    const refs = await images("happy_horse_references", 9);
    const bad = await tool("syntx_owner_generate_happy_horse_video", { model_id: "happy_horse_references", prompt: "bad", image_handles: [...refs, refs[0]] });
    assert.equal(bad.isError, true); assert.equal(posts, 0); assert.equal(quotes, 0);
    const refsResult = await tool("syntx_owner_generate_happy_horse_video", { model_id: "happy_horse_references", prompt: "Use all supplied references", image_handles: refs, aspect_ratio: "3:4", resolution: "1080P", video_duration: 6.5, seed: 0 });
    assert.notEqual(refsResult.isError, true, JSON.stringify(refsResult)); assert.equal((refsResult.structuredContent as any).status, "completed");
    assert.equal(bodies.get("happy-current-chat-1")!.settings.file_urls.length, 9); assert.equal(bodies.get("happy-current-chat-1")!.settings.seed, 0);
    const extras = await images("happy_horse_edit", 2), uploaded = await tool("syntx_owner_upload_happy_horse_edit_video", { filename: "edit55.mp4", mime_type: "video/mp4", content_base64: videoBytes.toString("base64") });
    assert.notEqual(uploaded.isError, true, JSON.stringify(uploaded)); assert.equal((uploaded.structuredContent as any).measured_duration_seconds, 55);
    const editArgs = { model_id: "happy_horse_edit", prompt: "Preserve action and refine light", reference_handle: (uploaded.structuredContent as any).reference_handle, image_handles: extras, resolution: "1080P", native_audio: true, seed: 123 };
    loseAck = true; const editResult = await tool("syntx_owner_generate_happy_horse_video", editArgs);
    assert.notEqual(editResult.isError, true, JSON.stringify(editResult)); assert.equal((editResult.structuredContent as any).status, "outcome_unknown");
    const body = bodies.get("happy-current-chat-2")!.settings; assert.equal(body.video_duration, 15); assert.equal(body.native_audio, true); assert.equal(body.seed, 123);
    assert.deepEqual(body.file_urls.map((file: any) => file.type), ["video", "image", "image"]);
    const recovered = await tool("syntx_owner_get_happy_horse_result", { recovery_id: (editResult.structuredContent as any).recovery_id });
    assert.equal((recovered.structuredContent as any).status, "completed", JSON.stringify(recovered)); assert.equal(posts, 2);
    const replay = await tool("syntx_owner_generate_happy_horse_video", editArgs); assert.equal(replay.isError, true); assert.equal(posts, 2); assert.equal(quotes, 4);
  } finally { await client.close(); await server.close(); await runtime.lifecycle.close(); store.close(); videoBytes.fill(0); await rm(directory, { recursive: true, force: true }); }
});
