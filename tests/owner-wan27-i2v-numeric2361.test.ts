import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OwnerWan27I2vReferenceService } from "../src/application/owner-wan27-i2v-reference-service.js";
import { OwnerWan27I2vGenerationService } from "../src/application/owner-wan27-i2v-generation-service.js";
import { registerSyntxOwnerWan27I2vTools, OWNER_WAN27_I2V_TOOL_NAMES } from "../src/mcp/owner-wan27-i2v-tools.js";

const ATTEMPT = "link_wan27i2v_sdk2349_owner_0123456789abcdef";
const IMAGE_URL = "https://r2.syntx.ai/wan27-i2v-sdk2349/first-frame.png";
const OUTPUT_URL = "https://r2.syntx.ai/wan27-i2v-sdk2349/result.mp4";
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const PROMPT = "A single portrait begins moving gently.";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width: number, height: number): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const value = Buffer.concat([Buffer.from(name, "ascii"), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(value));
    return Buffer.concat([length, value, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const row = Buffer.alloc(1 + width * 4), pixels = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(pixels, y * row.length);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

test("2361 numeric provider-ID MCP SDK flow uploads duplicate ACK metadata, dispatches once, and reads owned result", async () => {
  let now = Date.parse("2026-10-19T00:00:00.000Z");
  const binding = Object.freeze({ tenant_id: "wan27-i2v-sdk2349", subject: "synthetic-owner" });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "wan27-i2v-sdk2349", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-wan27-i2v-sdk-credential" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const bytes = png(300, 300), localSha = createHash("sha256").update(bytes).digest("hex");
  const stats = { uploads: 0, chats: 0, posts: 0, quotes: 0, balances: 0, subscriptions: 0, histories: 0, results: 0 };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    now += 10; // Each upstream round-trip advances observation time.
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "100" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++; assert.equal(url.searchParams.get("ai_name"), "wan_video"); assert.equal(url.searchParams.get("model_type"), "wan_27_i2v");
      assert.equal(url.searchParams.get("resolution"), "720P"); assert.equal(url.searchParams.get("video_duration"), "5");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      return json({ access: true, cost: 0.25, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      stats.uploads++;
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(String(form.get("model_type")), "wan_27_i2v"); assert.equal(String(form.get("destination")), "hidden");
      assert.equal(String(form.get("check_duplicates")), "true"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      // A duplicate ACK is trusted only with full filename/size/MIME/dimensions. No provider hash is returned or inferred.
      return json({ files: [{ url: IMAGE_URL, status: "duplicate", filename: file.name, mime_type: file.type,
        size: file.size, width: 300, height: 300 }] });
    }
    if (url.pathname === "/api/v1/chats") {
      stats.chats++; const body = JSON.parse(String(init.body)) as { title: string; scope: string };
      assert.equal(body.scope, "video"); assert.ok(body.title.startsWith("owner-wan27-i2v-")); return json({ uuid: "wan27i2v-sdk2349-chat" });
    }
    if (url.pathname === "/api/v1/video/generate") {
      stats.posts++; assert.equal(url.searchParams.get("ai_name"), "wan_video");
      const submitted = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      assert.deepEqual(submitted!.settings, { model_type: "wan_27_i2v", resolution: "720P", aspect_ratio: "1:1", video_duration: 5,
        prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, rendering_speed: "basic",
        file_urls: [{ type: "first_frame", url: IMAGE_URL }] });
      assert.equal(submitted!.chat_id, "wan27i2v-sdk2349-chat");
      return json({ id: 5001 });
    }
    if (url.pathname.endsWith("/wan27i2v-sdk2349-chat/messages")) {
      stats.histories++;
      const owner = { id: 5001, chat_id: 5000, author_id: 42, message_object: [
        { id: 5101, message_id: 5001, object_type: "text", object_text: PROMPT },
        { id: 5102, message_id: 5001, object_type: "first_frame", model_type: "wan_27_i2v", object_url: IMAGE_URL }
      ] };
      const bot = { id: 5002, chat_id: 5000, author_id: -1, message_object: [
        { id: 5201, message_id: 5002, object_type: "video", object_url: OUTPUT_URL, model_type: "wan_27_i2v", completed: true }
      ] };
      return json({ messages: [owner, bot], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/wan27i2v-sdk2349-chat/5002")) {
      stats.results++; return json({ id: 5002, chat_id: 5000, author_id: -1, message_object: [
        { id: 5201, message_id: 5002, object_type: "video", object_url: OUTPUT_URL, model_type: "wan_27_i2v", completed: true }
      ] });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const readClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const references = new OwnerWan27I2vReferenceService({ binding, linkService: links, resolveChatClient: () => chatClient,
    uploadDestination: "hidden", now: () => now });
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, "catalog"));
  const generation = new OwnerWan27I2vGenerationService({ binding, linkService: links, referenceService: references, catalog, catalogDirectory:"catalog",
    resolveChatClient: () => chatClient, createReadClient: readClient, now: () => now });
  const server = new McpServer({ name: "wan27-i2v-sdk2349", version: "1" });
  registerSyntxOwnerWan27I2vTools(server, { referenceService: references, generationService: generation });
  const client = new Client({ name: "wan27-i2v-sdk2349-client", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const upload = await client.callTool({ name: OWNER_WAN27_I2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
      model_id: "wan_27_i2v", filename: "first-frame.png", mime_type: "image/png", content_base64: bytes.toString("base64") } });
    assert.equal(upload.isError, undefined, JSON.stringify(upload));
    const uploaded = upload.structuredContent as { image_handle: string; sha256: string; size: number };
    assert.match(uploaded.image_handle, /^wan27i2v_image_[0-9a-f-]{36}$/u);
    assert.equal(uploaded.sha256, localSha, "the handle receipt uses the local source-byte hash, not a provider hash");
    assert.equal(uploaded.size, bytes.length);
    assert.equal(JSON.stringify(upload).includes(IMAGE_URL), false);
    const result = await client.callTool({ name: OWNER_WAN27_I2V_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT,
      model_id: "wan_27_i2v", image_handle: uploaded.image_handle, prompt: PROMPT, resolution: "720P", aspect_ratio: "1:1",
      video_duration: 5, prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null,
      native_audio: false, rendering_speed: "basic" } });
    assert.equal(result.isError, undefined, JSON.stringify({ result, stats }));
    const body = result.structuredContent as { status: string; artifacts: Array<{ object_url: string }>; backend_acceptance: string; cost_cap_enforced: boolean };
    assert.equal(body.status, "completed"); assert.deepEqual(body.artifacts.map(item => item.object_url), [OUTPUT_URL]);
    assert.equal(body.backend_acceptance, "UNPROVEN"); assert.equal(body.cost_cap_enforced, false);
    assert.deepEqual(stats, { uploads: 1, chats: 1, posts: 1, quotes: 2, balances: 2, subscriptions: 2, histories: 1, results: 1 });
  } finally { await client.close(); await server.close(); await generation.close(); await references.close(); bytes.fill(0); }
});
