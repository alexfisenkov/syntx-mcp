import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWan26R2vGenerationService, OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION } from "../src/application/owner-wan26-r2v-generation-service.js";
import { OwnerWan26R2vReferenceService } from "../src/application/owner-wan26-r2v-reference-service.js";
import { createOwnerWan26R2vRequestPreparer } from "../src/application/owner-wan26-r2v-request-preparer.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_WAN26_R2V_TOOL_NAMES, registerSyntxOwnerWan26R2vTools } from "../src/mcp/owner-wan26-r2v-tools.js";

const ATTEMPT = "link_wan26_r2v_mcp_1768_0123";
const BINDING = Object.freeze({ tenant_id: "wan26-r2v-mcp-1768", subject: "owner" });
const NOW = Date.parse("2026-10-16T10:00:00.000Z");
const MODEL_IDS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
type ModelId = typeof MODEL_IDS[number];

function broker(): SyntxCredentialBroker { return { async useCredential(use) { return use("synthetic-mcp-1768-credential"); } }; }
function json(value: unknown): Response { return Response.json(value); }
function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20); let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29); return bytes;
}
async function withClient<T>(server: McpServer, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "owner-wan26-r2v-mcp-1768", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); return await run(client); }
  finally { await client.close(); await server.close(); }
}
function dataOf(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  const structured = (result as Record<string, unknown>).structuredContent;
  return structured && typeof structured === "object" ? structured as Record<string, unknown> : {};
}

test("owner WAN26 R2V is absent from the default MCP server", async () => {
  await withClient(createMcpServer(createDefaultApplication()), async (client) => {
    const names = (await client.listTools()).tools.map((item) => item.name);
    assert.equal(names.some((name) => (OWNER_WAN26_R2V_TOOL_NAMES as readonly string[]).includes(name)), false);
  });
});

test("owner WAN26 R2V exposes eight closed MCP tools and completes owner-bound ordered image generation and page reads", async () => {
  const state = { now: NOW, posts: 0, chatNumber: 0,
    chats: new Map<string, { model: ModelId; prompt: string; ack: string; result: string; objects: string[] }>() };
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "r2v-mcp-1768", approval_url: "https://example.invalid/approval" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-link" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => state.now), { now: () => state.now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "GET" && url.pathname.endsWith("/user/balance")) return json({ balance: "900" });
    if (method === "GET" && url.pathname.endsWith("/user/subscription")) return json({ active: true, type: "PRO", end_date: new Date(state.now + 3_600_000).toISOString() });
    if (method === "GET" && url.pathname.endsWith("/get_model_info")) return json({ access: true, cost: 5, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (method === "POST" && url.pathname.endsWith("/chats/upload-files")) {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.type, "image/png");
      const ref = `https://r2.syntx.ai/r2v/${file.name}`;
      return json({ files: [{ id: `upload-${file.name}`, filename: file.name, url: ref, mime_type: file.type, content_type: file.type,
        type: "image", media_type: "image", status: "uploaded", size: file.size }] });
    }
    if (method === "POST" && url.pathname.endsWith("/chats")) return json({ uuid: `r2v-chat-${++state.chatNumber}` });
    if (method === "POST" && url.pathname.endsWith("/video/generate")) {
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: { model_type: ModelId; file_urls: { url: string; type: string }[] } };
      assert.equal(url.search, "?ai_name=wan_video"); assert.deepEqual(body.settings.file_urls.map((x) => x.url), ["https://r2.syntx.ai/r2v/first.png", "https://r2.syntx.ai/r2v/second.png"]);
      state.posts += 1; const ack = `r2v-ack-${state.posts}`, result = `r2v-result-${state.posts}`, objects = [`r2v-video-${state.posts}-0`, `r2v-video-${state.posts}-1`];
      state.chats.set(body.chat_id, { model: body.settings.model_type, prompt: body.prompt, ack, result, objects }); return json({ id: ack });
    }
    if (method === "GET" && url.pathname.endsWith("/messages")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-2)!); const chat = state.chats.get(id); assert.ok(chat);
      return json({ messages: [
        { id: chat.ack, chat_id: 77265, author_id: 27, message_object: [{ id: `${chat.ack}-text`, message_id: chat.ack, object_type: "text", model_type: chat.model, object_text: chat.prompt }] },
        { id: chat.result, chat_id: 77265, author_id: -1, message_object: chat.objects.map((object) => ({ id: object, message_id: chat.result,
          object_type: "video", model_type: chat.model, completed: true })) }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (method === "GET" && /\/chats\/[^/]+\/[^/]+$/u.test(url.pathname)) {
      const pieces = url.pathname.split("/").filter(Boolean), id = decodeURIComponent(pieces.at(-2)!); const chat = state.chats.get(id); assert.ok(chat);
      return json({ id: chat.result, chat_id: 77265, author_id: -1, message_object: chat.objects.map((object, index) => ({ id: object,
        message_id: chat.result, object_type: "video", model_type: chat.model, completed: true,
        object_url: `https://r2.syntx.ai/r2v/results/${object}.${index ? "webm" : "mp4"}` })) });
    }
    throw new Error(`Unexpected synthetic request ${method} ${url.pathname}`);
  };
  const chat = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl, requestTimeoutMs: 5_000 });
  const refs = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => chat,
    ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe", now: () => state.now });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService: refs, now: () => state.now });
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION, join(process.cwd(), "catalog")));
  const generation = new OwnerWan26R2vGenerationService({ binding: BINDING, linkService: links, catalog,
    catalog_version: OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION, preparer, referenceService: refs, resolveChatClient: () => chat,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker(), fetchImpl }), () => state.now),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: broker(), fetchImpl }), () => state.now), now: () => state.now });
  const server = new McpServer({ name: "syntx-mcp-test", version: "1" });
  const imageBase64 = png384().toString("base64");
  try {
    registerSyntxOwnerWan26R2vTools(server, { referenceService: refs, generationService: generation });
    await withClient(server, async (client) => {
      const listed = (await client.listTools()).tools.map((item) => item.name);
      assert.deepEqual(listed, [...OWNER_WAN26_R2V_TOOL_NAMES]);
      const invalidVideo = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT,
        model_id: "wan_26_r2v", filename: "clip.mov", mime_type: "video/quicktime", content_base64: "aGVsbG8=",
        start_seconds: 0, end_seconds: 1, total_reference_count: 1 } });
      assert.equal(invalidVideo.isError, true, "selected-video tool rejects non-MP4 input at its closed schema");
      const params = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[0], arguments: { unknown: true } });
      assert.equal(params.isError, true, "unknown input keys are rejected");
      const sourceResult = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[0], arguments: {} });
      assert.equal(dataOf(sourceResult).source_readiness, "PARTIAL_SOURCE_EXPLICIT_SETTINGS");
      assert.equal(dataOf(sourceResult).provider_acceptance, "UNPROVEN");
      const regularAudio = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT,
        model_id: "wan_26_r2v", prompt: "explicit invalid branch", resolution: "720P", aspect_ratio: "16:9", video_duration: 6,
        seed: null, native_audio: true, reference_handles: ["wan26ref_00000000000000000000000000000000"] } });
      const flashMissingAudio = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT,
        model_id: "wan_26_r2v_flash", prompt: "explicit invalid branch", resolution: "720P", aspect_ratio: "16:9", video_duration: 6,
        seed: null, reference_handles: ["wan26ref_00000000000000000000000000000000"] } });
      assert.equal(regularAudio.isError, true); assert.equal(flashMissingAudio.isError, true);

      for (const model_id of MODEL_IDS) {
        const first = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, model_id,
          filename: "first.png", mime_type: "image/png", content_base64: imageBase64 } });
        const second = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, model_id,
          filename: "second.png", mime_type: "image/png", content_base64: imageBase64 } });
        const h1 = String(dataOf(first).reference_handle), h2 = String(dataOf(second).reference_handle);
        assert.match(h1, /^wan26ref_[a-f0-9]{32}$/u); assert.match(h2, /^wan26ref_[a-f0-9]{32}$/u);
        const checked = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT, model_id, reference_handles: [h1, h2] } });
        assert.deepEqual(dataOf(checked).reference_handles, [h1, h2]); assert.equal(dataOf(checked).generation_permit, false);
        const paramsInput = { resolution: "720P", aspect_ratio: "16:9", video_duration: 6, seed: 7,
          ...(model_id === "wan_26_r2v_flash" ? { native_audio: false } : {}) };
        const generated = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT, model_id,
          prompt: `synthetic ${model_id}`, ...paramsInput, reference_handles: [h1, h2] } });
        assert.equal(generated.isError, undefined); assert.equal(dataOf(generated).status, "completed");
        assert.equal(dataOf(generated).status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
        assert.equal(dataOf(generated).provider_terminal_status, "UNPROVEN");
        assert.equal((dataOf(generated).artifacts as unknown[]).length, 2);
        const recovery_id = String(dataOf(generated).recovery_id);
        const recoveries = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[6], arguments: { link_attempt_id: ATTEMPT } });
        assert.equal(dataOf(recoveries).status, "listed");
        assert.ok((dataOf(recoveries).recoveries as Array<{ recovery_id: string }>).some((item) => item.recovery_id === recovery_id));
        const reconciled = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[5], arguments: { link_attempt_id: ATTEMPT, recovery_id } });
        assert.equal(dataOf(reconciled).recovery_id, recovery_id);
        const page = await client.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[7], arguments: { link_attempt_id: ATTEMPT, recovery_id, offset: 1 } });
        assert.equal(dataOf(page).offset, 1); assert.equal(dataOf(page).page_size, 64);
        assert.equal((dataOf(page).artifacts as unknown[]).length, 1);
      }
      assert.equal(state.posts, 2);
    });
  } finally { await generation.close(); await refs.close(); }
});
