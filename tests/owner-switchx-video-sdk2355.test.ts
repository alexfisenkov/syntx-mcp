import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthLinkStore } from "../src/auth/auth-link-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding } from "../src/auth/types.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OWNER_SWITCHX_VIDEO_TOOL_NAMES } from "../src/mcp/owner-switchx-video-tools.js";

const ATTEMPT = "link_switchx_video2355_owner_0123456789abcdef";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "switchx-video2355", subject: "source-bound-owner" });
const INPUT_URL = "https://r2.syntx.ai/switchx-video2355/input.mp4";
const OUTPUT_URL = "https://r2.syntx.ai/switchx-video2355/result.mp4";
const OUTPUT_URL_2 = "https://r2.syntx.ai/switchx-video2355/result-alt.mp4";
const CHAT = "switchx-video2355-chat", ACK = "switchx-video2355-echo", BOT = "switchx-video2355-bot";
const OBJECT = "switchx-video2355-object", OBJECT_2 = "switchx-video2355-object-2";
const INPUT_OBJECT = "switchx-video2355-input-object", PROMPT_OBJECT = "switchx-video2355-prompt-object";
const GENERATION_PROMPT = "Preserve the original scene and motion; make only a gentle, natural refinement.";
const MEDIA_TOOLS = [
  { ffmpeg: process.env.SYNTX_SWITCHX_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg", ffprobe: process.env.SYNTX_SWITCHX_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));

function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

async function localClip(t: { skip(message?: string): void }): Promise<{ root: string; filename: string; bytes: Uint8Array; squareBytes: Uint8Array } | undefined> {
  if (!MEDIA_TOOLS) { t.skip("ffmpeg/ffprobe pair is unavailable"); return undefined; }
  const root = await mkdtemp(join(tmpdir(), "syntx-switchx-sdk2355-")), path = join(root, "neutral-edit-bt709.mp4");
  execFileSync(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=blue:s=1280x720:r=24:d=5", "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709",
    "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35", "-movflags", "+faststart", "-y", path]);
  const squarePath = join(root, "neutral-square-1024.mp4");
  execFileSync(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=green:s=1024x1024:r=24:d=5", "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709",
    "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35", "-movflags", "+faststart", "-y", squarePath]);
  return { root, filename: "neutral-edit-bt709.mp4", bytes: new Uint8Array(await readFile(path)),
    squareBytes: new Uint8Array(await readFile(squarePath)) };
}

test("Switchx SDK uploads one measured video, sends the exact cost-bound GEN, then reads its result without retry", async (t) => {
  const clip = await localClip(t);
  if (!clip) return;
  let now = Date.parse("2026-10-19T16:00:00.000Z"), balanceReads = 0, subscriptionReads = 0, quoteReads = 0;
  let uploadCount = 0, chatCount = 0, generationCount = 0, indexReads = 0, historyReads = 0, resultReads = 0;
  let corruptOwnerDetailAuthor = false;
  const authStore = {
    async getSnapshot(binding: AuthBinding, attemptId: string) {
      assert.deepEqual(binding, BINDING); assert.equal(attemptId, ATTEMPT);
      return { attempt_id: ATTEMPT, authorization_profile: OBSERVED_AUTHORIZATION_PROFILE, status: "LINKED" as const,
        expires_at: null, linked: true };
    },
    async useCredential<T>(binding: AuthBinding, attemptId: string, use: (credential: { scheme: "Bearer"; value: string }) => T | Promise<T>) {
      assert.deepEqual(binding, BINDING); assert.equal(attemptId, ATTEMPT);
      return await use({ scheme: "Bearer", value: "synthetic-switchx-video2355" });
    }
  } as unknown as AuthLinkStore;

  const quotes: Array<{ ai_name: string | null; model_type: string | null; resolution: string | null; video_duration: string | null; frame_rate: string | null }> = [];
  const generationBodies: Array<Record<string, unknown>> = [];
  const ownerObjects = [
    { id: PROMPT_OBJECT, message_id: ACK, object_type: "text", object_text: GENERATION_PROMPT, completed: true, model_type: "switchx" },
    { id: INPUT_OBJECT, message_id: ACK, object_type: "video", object_url: INPUT_URL, completed: true, model_type: "switchx" }
  ];
  const botObjects = [
    { id: OBJECT, message_id: BOT, object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "switchx" },
    { id: OBJECT_2, message_id: BOT, object_type: "video", object_url: OUTPUT_URL_2, completed: true, model_type: "switchx" }
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { balanceReads++; now += 1_000; return response({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") { subscriptionReads++; now += 1_000; return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      quoteReads++; now += 1_000;
      quotes.push({ ai_name: url.searchParams.get("ai_name"), model_type: url.searchParams.get("model_type"),
        resolution: url.searchParams.get("resolution"), video_duration: url.searchParams.get("video_duration"), frame_rate: url.searchParams.get("frame_rate") });
      return response({ access: true, cost: 12, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadCount++;
      const form = init.body as FormData;
      assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true"); assert.equal(form.get("model_type"), "switchx");
      const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.name, clip.filename);
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), clip.bytes);
      return response({ files: [{ id: "switchx-video2355-file", filename: clip.filename, url: INPUT_URL, mime_type: "video/mp4", size: clip.bytes.byteLength, status: "success" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCount++; return response({ uuid: CHAT }); }
    if (url.pathname === "/api/v1/chats" && method === "GET") {
      indexReads++;
      assert.equal(url.search, "?scope=video&page=1&page_size=20");
      return response({ chats: [{ id: "2355", uuid: CHAT, scope: "video", title: "owner-switchx-video-23550000-0000-4000-8000-000000000001", created_at: "2026-10-19T16:00:00.000Z" }],
        pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationCount++; assert.equal(url.search, "?ai_name=beeble");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; generationBodies.push(body);
      return response({ id: ACK });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${ACK}` && method === "GET") {
      resultReads++;
      return response({ id: ACK, chat_id: 2355, author_id: corruptOwnerDetailAuthor ? -1 : 12345, message_object: ownerObjects });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/messages` && method === "GET") {
      historyReads++;
      return response({ messages: [
        { id: ACK, chat_id: 2355, author_id: 12345, message_object: ownerObjects },
        { id: BOT, chat_id: 2355, author_id: -1, message_object: botObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${BOT}` && method === "GET") {
      resultReads++;
      return response({ id: BOT, chat_id: 2355, author_id: -1, message_object: botObjects });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerSwitchxVideoEnabled: true, authStore, authBinding: BINDING,
    now: () => now, fetchImpl, ownerSwitchxVideoFfprobePath: MEDIA_TOOLS!.ffprobe,
    ownerSwitchxVideoUploadDestination: "uploaded", catalogDirectory: resolve(process.cwd(), "catalog") });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "switchx-video2355-sdk", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).filter((name) => OWNER_SWITCHX_VIDEO_TOOL_NAMES.includes(name as typeof OWNER_SWITCHX_VIDEO_TOOL_NAMES[number])).sort(),
      [...OWNER_SWITCHX_VIDEO_TOOL_NAMES].sort());
    const source = await client.callTool({ name: OWNER_SWITCHX_VIDEO_TOOL_NAMES[0], arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    const outsideInitialSlice = await client.callTool({ name: OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, prompt: "A synthetic square clip must be rejected before any upstream request.",
      filename: "neutral-square-1024.mp4", mime_type: "video/mp4", content_base64: Buffer.from(clip.squareBytes).toString("base64")
    } });
    assert.equal(outsideInitialSlice.isError, true);
    const rejectionContent = (outsideInitialSlice as unknown as { content: Array<{ type: string; text?: string }> }).content
      .find((item) => item.type === "text");
    assert.ok(rejectionContent?.text);
    const rejection = JSON.parse(rejectionContent.text) as { error: { code: string; message: string } };
    assert.equal(rejection.error.code, "INVALID_VIDEO");
    assert.match(rejection.error.message, /1280×720.*5 seconds.*24 fps/u);
    assert.deepEqual({ uploadCount, chatCount, generationCount, indexReads, historyReads, resultReads, balanceReads, subscriptionReads, quoteReads },
      { uploadCount: 0, chatCount: 0, generationCount: 0, indexReads: 0, historyReads: 0, resultReads: 0, balanceReads: 0, subscriptionReads: 0, quoteReads: 0 },
      "an out-of-slice input must fail before every upstream call");
    const generated = await client.callTool({ name: OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, prompt: GENERATION_PROMPT,
      filename: clip.filename, mime_type: "video/mp4", content_base64: Buffer.from(clip.bytes).toString("base64")
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const output = generated.structuredContent as { status: string; model_id: string; backend_acceptance: string;
      artifacts: Array<{ url: string; mime_type?: string }>; diagnostics: { gaps: string[] } };
    assert.equal(output.status, "completed"); assert.equal(output.model_id, "switchx");
    assert.equal(output.backend_acceptance, "UNPROVEN");
    assert.deepEqual(output.artifacts.map((artifact) => artifact.url), [OUTPUT_URL, OUTPUT_URL_2]);
    assert.deepEqual(output.diagnostics.gaps, []);
    const replay = await client.callTool({ name: OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, prompt: GENERATION_PROMPT,
      filename: clip.filename, mime_type: "video/mp4", content_base64: Buffer.from(clip.bytes).toString("base64")
    } });
    assert.equal(replay.isError, true); assert.match(JSON.stringify(replay), /INTENT_ALREADY_CLAIMED/u);
    const destinationOverride = await client.callTool({ name: OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, prompt: GENERATION_PROMPT,
      filename: clip.filename, mime_type: "video/mp4", content_base64: Buffer.from(clip.bytes).toString("base64"), upload_destination: "hidden"
    } });
    assert.equal(destinationOverride.isError, true, "upload destination remains operator-owned and cannot be overridden by an MCP caller");
    assert.deepEqual({ uploadCount, chatCount, generationCount, indexReads, historyReads, resultReads, balanceReads, subscriptionReads, quoteReads },
      { uploadCount: 1, chatCount: 1, generationCount: 1, indexReads: 1, historyReads: 1, resultReads: 2, balanceReads: 2, subscriptionReads: 2, quoteReads: 2 });
    assert.deepEqual(quotes, [
      { ai_name: "beeble", model_type: "switchx", resolution: "720P", video_duration: "5", frame_rate: "24" },
      { ai_name: "beeble", model_type: "switchx", resolution: "720P", video_duration: "5", frame_rate: "24" }
    ]);
    assert.deepEqual(generationBodies[0], { chat_id: CHAT,
      prompt: GENERATION_PROMPT, settings: {
        model_type: "switchx", resolution: "720P", mask_mode: "auto", video_duration: 5, frame_rate: 24,
        file_urls: [{ type: "video", url: INPUT_URL }]
      } });
    assert.equal(JSON.stringify(generated).includes(INPUT_URL), false, "the private uploaded input URL must not leave the native boundary");
    corruptOwnerDetailAuthor = true;
    const secondPrompt = GENERATION_PROMPT + " Separate synthetic author-binding case.";
    ownerObjects[0]!.object_text = secondPrompt;
    const wrongAuthor = await client.callTool({ name: OWNER_SWITCHX_VIDEO_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, prompt: secondPrompt,
      filename: clip.filename, mime_type: "video/mp4", content_base64: Buffer.from(clip.bytes).toString("base64")
    } });
    assert.equal(wrongAuthor.isError, true);
    assert.match(JSON.stringify(wrongAuthor), /DETAIL_BINDING_UNVERIFIED/u);
    assert.equal(generationCount, 2, "one dispatch per distinct synthetic intent, never an automatic retry");
    assert.equal(JSON.stringify(wrongAuthor).includes(INPUT_URL), false);
  } finally {
    await client.close(); await server.close(); await runtime.ownerSwitchxVideoLifecycle?.close(); await rm(clip.root, { recursive: true, force: true });
  }
});
