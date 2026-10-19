import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { OWNER_HEYGEN4_TOOL_NAMES, registerSyntxOwnerHeygen4Tools } from "../src/mcp/owner-heygen4-tools.js";
import { createOwnerHeygen4Runtime } from "../src/runtime/owner-heygen4-runtime.js";
import { readOwnerHeygen4OperatorConfiguration } from "../src/runtime/owner-heygen4-stdio-config.js";

const ATTEMPT = "link_heygen4_video2355_owner_0123456789abcdef";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "heygen4-video2355", subject: "source-bound-owner" });
const IMAGE_FILE_ID = "740904866";
const AUDIO_FILE_ID = "740904867";
const IMAGE_URL = "https://r2.syntx.ai/heygen4-video2355/reference.png";
const AUDIO_URL = "https://r2.syntx.ai/heygen4-video2355/speech.wav";
const OUTPUT_URL = "https://r2.syntx.ai/heygen4-video2355/result.mp4";
const CHAT = "heygen4-video2355-chat", ACK = "heygen4-video2355-echo", BOT = "heygen4-video2355-bot";
const OBJECT = "heygen4-video2355-object";
const MEDIA_TOOLS = [
  { ffmpeg: process.env.SYNTX_HEYGEN4_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg", ffprobe: process.env.SYNTX_HEYGEN4_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));

function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

async function localAssets(t: { skip(message?: string): void }): Promise<{ root: string; image: Uint8Array; audio: Uint8Array } | undefined> {
  if (!MEDIA_TOOLS) { t.skip("ffmpeg/ffprobe pair is unavailable"); return undefined; }
  const root = await mkdtemp(join(tmpdir(), "syntx-heygen4-sdk2355-"));
  const imagePath = join(root, "neutral-reference.png"), audioPath = join(root, "neutral-audio.wav");
  execFileSync(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=512x512:d=1",
    "-frames:v", "1", "-y", imagePath]);
  execFileSync(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
    "-c:a", "pcm_s16le", "-y", audioPath]);
  return { root, image: new Uint8Array(await readFile(imagePath)), audio: new Uint8Array(await readFile(audioPath)) };
}

test("HeyGen 4 SDK requires one existing image plus one existing audio and imports exact bytes read-only", async (t) => {
  const assets = await localAssets(t); if (!assets) return;
  let now = Date.parse("2026-10-19T16:30:00.000Z"), balanceReads = 0, subscriptionReads = 0, quoteReads = 0;
  let inventoryReads = 0, objectReads = 0, uploadPosts = 0, chatPosts = 0, generationPosts = 0, historyReads = 0, resultReads = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "heygen4-video2355-upstream", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-heygen4-video2355" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const inventoryRows = [
    { id: Number(IMAGE_FILE_ID), url: IMAGE_URL, hash: "opaque-provider-hash-image", type: "image", model_type: "existing", created_at: null,
      updated_at: null, metadata: { name: "neutral-reference.png", mime_type: "image/png", size: assets.image.byteLength, width: 512, height: 512 } },
    { id: Number(AUDIO_FILE_ID), url: AUDIO_URL, hash: "opaque-provider-hash-audio", type: "audio", model_type: "existing", created_at: null,
      updated_at: null, metadata: { name: "neutral-audio.wav", mime_type: "audio/wav", size: assets.audio.byteLength } }
  ];
  const costs: Array<{ ai_name: string | null; model_type: string | null; duration: string | null }> = [];
  const generationBodies: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { balanceReads++; now += 1_000; return response({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") { subscriptionReads++; now += 1_000; return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      quoteReads++; now += 1_000; costs.push({ ai_name: url.searchParams.get("ai_name"), model_type: url.searchParams.get("model_type"),
        duration: url.searchParams.get("duration") });
      return response({ access: true, cost: 12, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/files/uploaded" && method === "GET") {
      inventoryReads++; assert.equal(url.search, "?scope=all&page=1&page_size=10");
      return response({ has_more: false, page: 1, page_size: 10, total: 2, items: inventoryRows });
    }
    if (url.href === IMAGE_URL && method === "GET") {
      objectReads++; assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).has("authorization"), false); assert.equal(new Headers(init.headers).has("cookie"), false);
      return new Response(Buffer.from(assets.image), { status: 200, headers: { "content-type": "image/png", "content-length": String(assets.image.byteLength) } });
    }
    if (url.href === AUDIO_URL && method === "GET") {
      objectReads++; assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).has("authorization"), false); assert.equal(new Headers(init.headers).has("cookie"), false);
      return new Response(Buffer.from(assets.audio), { status: 200, headers: { "content-type": "audio/wav", "content-length": String(assets.audio.byteLength) } });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") { uploadPosts++; throw new Error("uploadable:false path must not upload"); }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatPosts++; return response({ uuid: CHAT }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationPosts++; assert.equal(url.search, "?ai_name=heygen");
      generationBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>); return response({ id: ACK });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${ACK}` && method === "GET") {
      return response({ id: ACK, chat_id: 2355, author_id: 12345, message_object: [] });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/messages` && method === "GET") {
      historyReads++;
      return response({ messages: [
        { id: ACK, chat_id: 2355, author_id: 12345, message_object: [] },
        { id: BOT, chat_id: 2355, author_id: -1, message_object: [{ id: OBJECT, message_id: BOT,
          object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "heygen4" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${BOT}` && method === "GET") {
      resultReads++;
      return response({ id: BOT, chat_id: 2355, author_id: -1, message_object: [{ id: OBJECT, message_id: BOT,
        object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "heygen4" }] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const broker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const readClient = () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl });
  const runtime = createOwnerHeygen4Runtime({ binding: BINDING, linkService: links, ffprobePath: MEDIA_TOOLS!.ffprobe,
    createChatClient: () => chatClient, createReadClient: readClient, now: () => now, catalogDirectory: resolve(process.cwd(), "catalog") });
  const server = new McpServer({ name: "heygen4-video2355", version: "1" });
  registerSyntxOwnerHeygen4Tools(server, { importService: runtime.importService, service: runtime.generationService });
  const client = new Client({ name: "heygen4-video2355-sdk", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), OWNER_HEYGEN4_TOOL_NAMES);
    const source = await client.callTool({ name: OWNER_HEYGEN4_TOOL_NAMES[0], arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    const parameters = await client.callTool({ name: OWNER_HEYGEN4_TOOL_NAMES[2], arguments: {} });
    assert.equal(parameters.isError, undefined, JSON.stringify(parameters));
    assert.deepEqual((parameters.structuredContent as { cost_parameter_keys: string[] }).cost_parameter_keys, ["duration"]);
    assert.equal(readOwnerHeygen4OperatorConfiguration(false, undefined), undefined);
    assert.throws(() => readOwnerHeygen4OperatorConfiguration(true, "relative/ffprobe"), /OWNER_HEYGEN4_OPERATOR_CONFIGURATION_INVALID/u);
    const imageImport = await client.callTool({ name: OWNER_HEYGEN4_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, file_id: IMAGE_FILE_ID,
      media_type: "image", filename: "neutral-reference.png", mime_type: "image/png", content_base64: Buffer.from(assets.image).toString("base64") } });
    assert.equal(imageImport.isError, undefined, JSON.stringify(imageImport));
    const image = imageImport.structuredContent as { reference_handle: string };
    const audioImport = await client.callTool({ name: OWNER_HEYGEN4_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, file_id: AUDIO_FILE_ID,
      media_type: "audio", filename: "neutral-audio.wav", mime_type: "audio/wav", content_base64: Buffer.from(assets.audio).toString("base64") } });
    assert.equal(audioImport.isError, undefined, JSON.stringify(audioImport));
    const audio = audioImport.structuredContent as { reference_handle: string; duration_seconds: number };
    assert.equal(audio.duration_seconds, 5);
    assert.equal(JSON.stringify(imageImport).includes(IMAGE_URL), false); assert.equal(JSON.stringify(audioImport).includes(AUDIO_URL), false);
    const generated = await client.callTool({ name: OWNER_HEYGEN4_TOOL_NAMES[3], arguments: {
      link_attempt_id: ATTEMPT, prompt: "Keep the supplied subject and audio timing; avoid new dialogue or identity changes.",
      image_handle: image.reference_handle, audio_handle: audio.reference_handle
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const output = generated.structuredContent as { status: string; model_id: string; backend_acceptance: string;
      artifacts: Array<{ url: string }>; diagnostics: { gaps: string[] } };
    assert.equal(output.status, "completed", JSON.stringify(output)); assert.equal(output.model_id, "heygen4");
    assert.equal(output.backend_acceptance, "UNPROVEN"); assert.equal(output.artifacts[0]?.url, OUTPUT_URL);
    assert.deepEqual(output.diagnostics.gaps, []);
    assert.deepEqual({ inventoryReads, objectReads, uploadPosts, chatPosts, generationPosts, historyReads, resultReads,
      balanceReads, subscriptionReads, quoteReads }, { inventoryReads: 2, objectReads: 2, uploadPosts: 0, chatPosts: 1,
      generationPosts: 1, historyReads: 1, resultReads: 1, balanceReads: 2, subscriptionReads: 2, quoteReads: 2 });
    assert.deepEqual(costs, [{ ai_name: "heygen", model_type: "heygen4", duration: "5" },
      { ai_name: "heygen", model_type: "heygen4", duration: "5" }]);
    assert.deepEqual(generationBodies[0], { chat_id: CHAT, prompt: "Keep the supplied subject and audio timing; avoid new dialogue or identity changes.",
      settings: { model_type: "heygen4", aspect_ratio: "16:9", duration: 5, file_urls: [
        { type: "image", url: IMAGE_URL }, { type: "audio", url: AUDIO_URL }
      ] } });
    const wire = JSON.stringify(generated);
    assert.equal(wire.includes(IMAGE_URL), false); assert.equal(wire.includes(AUDIO_URL), false);
    assert.equal(Object.hasOwn(generationBodies[0]!.settings as Record<string, unknown>, "avatar_id"), false);
    assert.equal(Object.hasOwn(generationBodies[0]!.settings as Record<string, unknown>, "voice_id"), false);
    const replay = await client.callTool({ name: OWNER_HEYGEN4_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT,
      prompt: "Keep the supplied subject and audio timing; avoid new dialogue or identity changes.",
      image_handle: image.reference_handle, audio_handle: audio.reference_handle } });
    assert.equal(replay.isError, true); assert.match(JSON.stringify(replay), /INTENT_ALREADY_CLAIMED/u);
    assert.equal(generationPosts, 1);
  } finally { await client.close(); await server.close(); await runtime.lifecycle.close(); await rm(assets.root, { recursive: true, force: true }); }
});
