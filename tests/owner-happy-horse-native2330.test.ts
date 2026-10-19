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
import { registerSyntxOwnerHappyHorseTools, OWNER_HAPPY_HORSE_TOOL_NAMES } from "../src/mcp/owner-happy-horse-tools.js";
import { createOwnerHappyHorseRuntime } from "../src/runtime/owner-happy-horse-runtime.js";
import { readOwnerHappyHorseFlag, readOwnerHappyHorseOperatorConfiguration } from "../src/runtime/owner-happy-horse-stdio-config.js";
import { releaseValidatedOwnerHappyHorseImage, validateOwnerHappyHorseImage } from "../src/application/owner-happy-horse-image-policy.js";

const ATTEMPT = "link_happy_horse2330_owner_0123456789abcdef";
const OUTPUT_URL = "https://r2.syntx.ai/happy-horse2330/result.mp4";
const IMAGE_URL = "https://r2.syntx.ai/happy-horse2330/first-frame.png";
const VIDEO_URL = "https://r2.syntx.ai/happy-horse2330/edit-source.mp4";
const FFMPEG = process.env.SYNTX_HAPPY_HORSE_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_HAPPY_HORSE_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const OWNER_TITLE_PREFIX = "owner-happy-horse-";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function safeToolError(result: unknown): string {
  let row: { readonly isError?: boolean | undefined; readonly content?: readonly unknown[] | undefined } = {};
  if (result && typeof result === "object") row = result as typeof row;
  const text = (row.content ?? []).flatMap(item => item && typeof item === "object" && "text" in item &&
    typeof (item as { text?: unknown }).text === "string" ? [(item as { text: string }).text.slice(0, 160)] : []).join(" | ");
  return JSON.stringify({ isError: row.isError === true, code: text || "NO_TEXT_CONTENT" });
}
function safeNativeError(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = Object.getOwnPropertyDescriptor(error, "code"), name = Object.getOwnPropertyDescriptor(error, "name");
  const safeCode = code && "value" in code && typeof code.value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code.value) ? code.value : "NO_CODE";
  const safeName = name && "value" in name && typeof name.value === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name.value) ? name.value : "Error";
  return `${safeName}:${safeCode}`;
}
function png400(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(640, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}

test("2330 HappyHorse opt-in is independent and ffprobe/destination are required only when enabled", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHappyHorseFlag(value), false);
  assert.equal(readOwnerHappyHorseFlag("1"), true);
  assert.equal(readOwnerHappyHorseOperatorConfiguration(false, undefined, undefined), undefined);
  assert.equal(readOwnerHappyHorseOperatorConfiguration(false, "invalid", "relative/ffprobe"), undefined);
  assert.throws(() => readOwnerHappyHorseFlag("true"));
  assert.throws(() => readOwnerHappyHorseOperatorConfiguration(true, "uploaded", undefined));
  assert.throws(() => readOwnerHappyHorseOperatorConfiguration(true, "other", "/opt/homebrew/bin/ffprobe"));
  assert.deepEqual(readOwnerHappyHorseOperatorConfiguration(true, "hidden", "/opt/homebrew/bin/ffprobe"),
    { uploadDestination: "hidden", ffprobePath: "/opt/homebrew/bin/ffprobe" });
});

test("2330 MCP SDK executes one first-frame image and one locally probed edit-video flow", async t => {
  if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) { t.skip("local ffmpeg/ffprobe pair unavailable for genuine synthetic edit-video fixture"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-happy-horse-2330-"));
  const videoPath = join(directory, "edit-source.mp4");
  let videoBytes: Buffer;
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x480:r=24:d=3.4",
      "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264",
      "-movflags", "+faststart", "-y", videoPath]);
    videoBytes = await readFile(videoPath);
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const now = Date.parse("2026-10-19T00:00:00.000Z");
  const binding = Object.freeze({ tenant_id: "happy-horse2330", subject: "synthetic-owner" });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "happy-horse2330", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-happy-horse2330-credential" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);

  const counts = { uploads: 0, chats: 0, posts: 0, quotes: 0, balances: 0, subscriptions: 0, histories: 0, details: 0 };
  const uploads: Array<{ model: string; mime: string; bytes: Buffer; destination: string }> = [];
  const operations = new Map<number, { chat: string; model: string; prompt: string; inputUrl: string; inputType: "image" | "video" }>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { counts.balances++; return json({ balance: "20.5" }); }
    if (url.pathname.endsWith("user/subscription")) { counts.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      counts.quotes++;
      assert.equal(url.searchParams.get("ai_name"), "happy_horse");
      assert.ok(["happy_horse_first_frame", "happy_horse_edit"].includes(url.searchParams.get("model_type") ?? ""));
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "720P"); assert.equal(url.searchParams.get("video_duration"), "5");
      return json({ access: true, cost: 0.2, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      counts.uploads++;
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      const model = String(form.get("model_type")), destination = String(form.get("destination"));
      const media = model === "happy_horse_edit" ? "video" : "image";
      const ref = media === "image" ? IMAGE_URL : VIDEO_URL;
      uploads.push({ model, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()), destination });
      return json({ files: [{ url: ref, status: "success", mime_type: file.type, type: media, media_type: media, filename: file.name, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      counts.chats++; const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.scope, "video"); assert.ok(String(body.title).startsWith(OWNER_TITLE_PREFIX));
      return json({ uuid: `happychat${counts.chats}` });
    }
    if (url.pathname.endsWith("/video/generate")) {
      counts.posts++;
      assert.equal(url.searchParams.get("ai_name"), "happy_horse"); assert.deepEqual([...url.searchParams.keys()], ["ai_name"]);
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      const model = String(body.settings.model_type), expectedType = model === "happy_horse_edit" ? "video" : "first_frame";
      const inputUrl = model === "happy_horse_edit" ? VIDEO_URL : IMAGE_URL;
      assert.deepEqual(body.settings, { model_type: model, aspect_ratio: "16:9", resolution: "720P", video_duration: 5,
        seed: null, file_urls: [{ type: expectedType, url: inputUrl }] });
      assert.equal(body.chat_id, `happychat${counts.posts}`);
      operations.set(counts.posts, { chat: body.chat_id, model, prompt: body.prompt, inputUrl, inputType: expectedType === "video" ? "video" : "image" });
      return json({ id: `owner-${counts.posts}` });
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(happychat\d+)\/messages$/u);
    if (historyMatch) {
      counts.histories++;
      const operation = [...operations.values()].find(row => row.chat === historyMatch[1]); assert.ok(operation);
      const n = Number(operation.chat.replace("happychat", ""));
      const owner = { id: `owner-${n}`, chat_id: `provider-${n}`, author_id: 42, message_object: [
        { id: `prompt-${n}`, message_id: `owner-${n}`, object_type: "text", object_text: operation.prompt },
        { id: `source-${n}`, message_id: `owner-${n}`, object_type: operation.inputType, object_url: operation.inputUrl }
      ] };
      const bot = { id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
        { id: `video-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: OUTPUT_URL, model_type: operation.model, completed: true }
      ] };
      return json({ messages: [owner, bot], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detailMatch = url.pathname.match(/^\/api\/v1\/chats\/(happychat\d+)\/bot-(\d+)$/u);
    if (detailMatch) {
      counts.details++; const n = Number(detailMatch[1]!.replace("happychat", "")); const operation = operations.get(n); assert.ok(operation);
      return json({ id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
        { id: `video-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: OUTPUT_URL, model_type: operation.model, completed: true }
      ] });
    }
    throw new Error(`Unexpected synthetic HappyHorse route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const readClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const chatClient = () => new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const operator = readOwnerHappyHorseOperatorConfiguration(true, "hidden", FFPROBE)!;
  const runtime = createOwnerHappyHorseRuntime({ binding, linkService: links, createReadClient: readClient, createChatClient: chatClient,
    uploadDestination: operator.uploadDestination, ffprobePath: operator.ffprobePath, now: () => now });
  const mcp = new McpServer({ name: "happy-horse2330", version: "1" });
  registerSyntxOwnerHappyHorseTools(mcp, { referenceService: runtime.referenceService,
    editVideoReferenceService: runtime.editVideoReferenceService, generationService: runtime.generationService });
  const client = new Client({ name: "happy-horse2330-client", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), OWNER_HAPPY_HORSE_TOOL_NAMES);
    const uploadedImage = await client.callTool({ name: OWNER_HAPPY_HORSE_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT,
      model_id: "happy_horse_first_frame", filename: "first-frame.png", mime_type: "image/png", content_base64: png400().toString("base64") } });
    if (uploadedImage.isError) {
      const receipt = validateOwnerHappyHorseImage({ model_id: "happy_horse_first_frame", filename: "first-frame.png", mime_type: "image/png", bytes: png400() });
      let nativeDiagnosis: string;
      try {
        const nativeContext = await chatClient().uploadOwnerHappyHorseImage({ media: receipt, destination: "hidden" });
        nativeDiagnosis = `native-context=${nativeContext.status}:${nativeContext.model_id}:${nativeContext.size}`;
      } catch (error) { nativeDiagnosis = `native-error=${safeNativeError(error)}`; }
      finally { releaseValidatedOwnerHappyHorseImage(receipt); }
      assert.equal(uploadedImage.isError, undefined, `synthetic image upload error: ${safeToolError(uploadedImage)}; ` +
        `native-diagnostic=${nativeDiagnosis}; upload-fetch-count=${counts.uploads}; upload-metadata=${JSON.stringify(uploads.map(row => ({
          model: row.model, mime: row.mime, size: row.bytes.byteLength, destination: row.destination })) )}`);
    }
    assert.equal(JSON.stringify(uploadedImage).includes(IMAGE_URL), false);
    const imageHandle = (uploadedImage.structuredContent as { reference_handle: string }).reference_handle;
    const firstFrame = await client.callTool({ name: OWNER_HAPPY_HORSE_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT,
      model_id: "happy_horse_first_frame", prompt: "A person looks toward the morning light.", aspect_ratio: "16:9", resolution: "720P",
      video_duration: 5, seed: null, reference_handle: imageHandle } });
    assert.equal(firstFrame.isError, undefined, `synthetic first-frame generation error: ${safeToolError(firstFrame)}`);
    assert.equal((firstFrame.structuredContent as { status: string }).status, "completed");

    const uploadedVideo = await client.callTool({ name: OWNER_HAPPY_HORSE_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
      filename: "edit-source.mp4", mime_type: "video/mp4", content_base64: videoBytes.toString("base64") } });
    assert.equal(uploadedVideo.isError, undefined, `synthetic edit upload error: ${safeToolError(uploadedVideo)}`);
    const videoHandle = (uploadedVideo.structuredContent as { reference_handle: string }).reference_handle;
    const edit = await client.callTool({ name: OWNER_HAPPY_HORSE_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT,
      model_id: "happy_horse_edit", prompt: "Preserve the action and refine the light.", aspect_ratio: "16:9", resolution: "720P",
      video_duration: 5, seed: null, reference_handle: videoHandle } });
    assert.equal(edit.isError, undefined, `synthetic edit generation error: ${safeToolError(edit)}`);
    assert.equal((edit.structuredContent as { status: string }).status, "completed");
    assert.equal((edit.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");

    assert.equal(counts.uploads, 2); assert.equal(counts.chats, 2); assert.equal(counts.posts, 2);
    assert.equal(counts.quotes, 4); assert.equal(counts.balances, 4); assert.equal(counts.subscriptions, 4);
    assert.equal(counts.histories, 2); assert.equal(counts.details, 2);
    assert.deepEqual(uploads.map(upload => [upload.model, upload.destination]), [["happy_horse_first_frame", "hidden"], ["happy_horse_edit", "hidden"]]);
    assert.deepEqual(uploads[0]!.bytes, png400()); assert.deepEqual(uploads[1]!.bytes, videoBytes);
  } finally {
    await client.close(); await mcp.close(); await runtime.lifecycle.close(); await rm(directory, { recursive: true, force: true });
  }
});
