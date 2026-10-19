import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { registerSyntxOwnerActTwoTools, OWNER_ACTTWO_TOOL_NAMES } from "../src/mcp/owner-acttwo-tools.js";
import { createOwnerActTwoRuntime } from "../src/runtime/owner-acttwo-runtime.js";

const ATTEMPT = "link_acttwo2355_owner_0123456789abcdef";
const IMAGE_URL = "https://r2.syntx.ai/acttwo2355/character.png";
const VIDEO_URL = "https://r2.syntx.ai/acttwo2355/performance.mp4";
const OUTPUT_URL = "https://r2.syntx.ai/acttwo2355/result.mp4";
const FFMPEG = process.env.SYNTX_ACTTWO_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_ACTTWO_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png640(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(640, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function safeToolError(result: unknown): string {
  const row = result && typeof result === "object" ? result as { isError?: boolean; content?: readonly unknown[] } : {};
  const text = (row.content ?? []).flatMap(item => item && typeof item === "object" && "text" in item &&
    typeof (item as { text?: unknown }).text === "string" ? [(item as { text: string }).text.slice(0, 160)] : []).join(" | ");
  return JSON.stringify({ isError: row.isError === true, code: text || "NO_TEXT_CONTENT" });
}

test("ActTwo MCP SDK uploads one image and one measured MP4, preflights twice, and dispatches one owned operation", async t => {
  if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) { t.skip("local ffmpeg/ffprobe pair unavailable for synthetic ActTwo SDK fixture"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-acttwo-sdk-2355-"));
  const videoPath = join(directory, "performance.mp4");
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=teal:s=640x480:r=24:d=5",
    "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264",
    "-movflags", "+faststart", "-y", videoPath]);
  const imageBytes = png640(), videoBytes = await readFile(videoPath);
  const now = Date.parse("2026-10-19T00:00:00.000Z");
  const binding = Object.freeze({ tenant_id: "acttwo2355", subject: "synthetic-owner" });
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "acttwo2355", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-acttwo2355-credential" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);

  const counts = { uploads: 0, chats: 0, posts: 0, quotes: 0, balances: 0, subscriptions: 0, histories: 0, details: 0 };
  const uploads: Array<{ media: string; model: string; filename: string; mime_type: string; size: number; destination: string }> = [];
  const operations = new Map<string, { readonly chat: string; readonly imageUrl: string; readonly videoUrl: string }>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { counts.balances += 1; return json({ balance: "20.5" }); }
    if (url.pathname.endsWith("user/subscription")) { counts.subscriptions += 1; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      counts.quotes += 1; assert.equal(url.searchParams.get("ai_name"), "runway"); assert.equal(url.searchParams.get("model_type"), "acttwo");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "video_duration"]);
      assert.equal(url.searchParams.get("video_duration"), "5");
      return json({ access: true, cost: 0.2, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      counts.uploads += 1;
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      const model = String(form.get("model_type")), destination = String(form.get("destination"));
      assert.equal(model, "acttwo"); assert.equal(destination, "hidden");
      const media = file.type === "video/mp4" ? "video" : "image";
      assert.ok((media === "video" && file.name === "performance.mp4") || (media === "image" && file.name === "character.png"));
      uploads.push({ media, model, filename: file.name, mime_type: file.type, size: file.size, destination });
      return json({ files: [{ url: media === "video" ? VIDEO_URL : IMAGE_URL, status: "duplicate", mime_type: file.type,
        type: media, media_type: media, filename: file.name, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      counts.chats += 1; const body = JSON.parse(String(init.body)) as { scope: string; title: string };
      assert.equal(body.scope, "video"); assert.ok(body.title.startsWith("owner-acttwo-")); return json({ uuid: `acttwochat${counts.chats}` });
    }
    if (url.pathname.endsWith("/video/generate")) {
      counts.posts += 1; assert.equal(url.searchParams.get("ai_name"), "runway"); assert.deepEqual([...url.searchParams.keys()], ["ai_name"]);
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      assert.equal(body.prompt, "");
      assert.deepEqual(body.settings, { model_type: "acttwo", aspect_ratio: "11", video_duration: 5, seed: null, expression: 3,
        file_urls: [{ type: "video", url: VIDEO_URL }, { type: "image", url: IMAGE_URL }] });
      assert.equal(body.chat_id, `acttwochat${counts.posts}`);
      operations.set(`acttwochat${counts.posts}`, { chat: body.chat_id, imageUrl: IMAGE_URL, videoUrl: VIDEO_URL });
      return json({ id: `owner-${counts.posts}` });
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(acttwochat\d+)\/messages$/u);
    if (historyMatch) {
      counts.histories += 1; const operation = operations.get(historyMatch[1]!); assert.ok(operation);
      const n = historyMatch[1]!.replace("acttwochat", "");
      return json({ messages: [
        { id: `owner-${n}`, chat_id: `provider-${n}`, author_id: 42, message_object: [
          { id: `prompt-${n}`, message_id: `owner-${n}`, object_type: "text", object_text: "" },
          { id: `character-${n}`, message_id: `owner-${n}`, object_type: "image", object_url: operation.imageUrl, model_type: "acttwo" },
          { id: `performance-${n}`, message_id: `owner-${n}`, object_type: "video", object_url: operation.videoUrl, model_type: "acttwo" }
        ] },
        { id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
          { id: `result-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: OUTPUT_URL, model_type: "acttwo", completed: true }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detailMatch = url.pathname.match(/^\/api\/v1\/chats\/(acttwochat\d+)\/bot-(\d+)$/u);
    if (detailMatch) {
      counts.details += 1; const n = detailMatch[1]!.replace("acttwochat", "");
      return json({ id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
        { id: `result-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: OUTPUT_URL, model_type: "acttwo", completed: true }
      ] });
    }
    throw new Error(`Unexpected synthetic ActTwo route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const readClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const chatClient = () => new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const runtime = createOwnerActTwoRuntime({ binding, linkService: links, createReadClient: readClient, createChatClient: chatClient,
    uploadDestination: "hidden", ffprobePath: FFPROBE, catalogDirectory: join(process.cwd(), "catalog"), now: () => now });
  const mcp = new McpServer({ name: "acttwo2355", version: "1" });
  registerSyntxOwnerActTwoTools(mcp, { imageReferenceService: runtime.imageReferenceService,
    videoReferenceService: runtime.videoReferenceService, generationService: runtime.generationService });
  const client = new Client({ name: "acttwo2355-client", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), OWNER_ACTTWO_TOOL_NAMES);
    const character = await client.callTool({ name: OWNER_ACTTWO_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT,
      filename: "character.png", mime_type: "image/png", content_base64: imageBytes.toString("base64") } });
    assert.equal(character.isError, undefined, `ActTwo character image upload error: ${safeToolError(character)}`);
    const imageHandle = (character.structuredContent as { reference_handle: string }).reference_handle;
    const performance = await client.callTool({ name: OWNER_ACTTWO_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
      filename: "performance.mp4", mime_type: "video/mp4", content_base64: videoBytes.toString("base64") } });
    assert.equal(performance.isError, undefined, `ActTwo performance video upload error: ${safeToolError(performance)}`);
    const videoHandle = (performance.structuredContent as { reference_handle: string }).reference_handle;
    const generated = await client.callTool({ name: OWNER_ACTTWO_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, model_id: "acttwo",
      aspect_ratio: "1:1", seed: null, expression: 3, character_image_handle: imageHandle, performance_video_handle: videoHandle } });
    assert.equal(generated.isError, undefined, `ActTwo generation error: ${safeToolError(generated)}`);
    assert.equal((generated.structuredContent as { status: string }).status, "completed");
    assert.equal((generated.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
    assert.deepEqual(counts, { uploads: 2, chats: 1, posts: 1, quotes: 2, balances: 2, subscriptions: 2, histories: 1, details: 1 });
    assert.deepEqual(uploads.map(row => [row.media, row.model, row.destination]), [["image", "acttwo", "hidden"], ["video", "acttwo", "hidden"]]);
    assert.deepEqual(uploads[0]!.size, imageBytes.byteLength); assert.equal(uploads[1]!.size, videoBytes.byteLength);
  } finally {
    await client.close(); await mcp.close(); await runtime.lifecycle.close();
    imageBytes.fill(0); videoBytes.fill(0); await rm(directory, { recursive: true, force: true });
  }
});
