import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerRunwayI2vReferenceService } from "../src/application/owner-runway-i2v-reference-service.js";
import { OwnerRunwayI2vGenerationService } from "../src/application/owner-runway-i2v-generation-service.js";
import { loadOwnerRunwayI2vRuntimeCatalog } from "../src/application/owner-runway-i2v-cost.js";
import { registerSyntxOwnerRunwayI2vTools, OWNER_RUNWAY_I2V_TOOL_NAMES } from "../src/mcp/owner-runway-i2v-tools.js";

const ATTEMPT = "link_runway_gen45sdk_2339_owner_0123456789abcdef";
const MODEL = "gen4.5i2v" as const;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png16x9(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(1_280, 16); bytes.writeUInt32BE(720, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}

test("2339 moving-clock MCP SDK flow sends all Gen4.5 duration strings and returns owned results", async () => {
  let now = Date.parse("2026-10-19T00:00:00.000Z"), expectedDuration = "5.0";
  const binding = Object.freeze({ tenant_id: "runway-gen45-sdk2339", subject: "synthetic-owner" });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "runway-gen45-sdk2339", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-runway-gen45-sdk-credential" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const counts = { uploads: 0, chats: 0, posts: 0, quotes: 0, balances: 0, subscriptions: 0, histories: 0, details: 0 };
  const operations = new Map<string, { prompt: string; imageUrl: string; duration: string; outputUrl: string }>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    now += 10; // Provider observations advance after every independent request.
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { counts.balances++; return json({ balance: "25.0" }); }
    if (url.pathname.endsWith("user/subscription")) { counts.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      counts.quotes++; assert.equal(url.searchParams.get("ai_name"), "runway"); assert.equal(url.searchParams.get("model_type"), MODEL);
      assert.equal(url.searchParams.get("video_duration"), expectedDuration);
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "video_duration"]);
      return json({ access: true, cost: 0.5, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      counts.uploads++; const form = init.body as FormData, uploaded = form.get("files"); assert.ok(uploaded instanceof File);
      assert.equal(String(form.get("model_type")), MODEL); assert.equal(String(form.get("destination")), "hidden");
      assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), png16x9());
      const imageUrl = `https://r2.syntx.ai/runway-gen45-sdk2339/frame-${counts.uploads}.png`;
      return json({ files: [{ url: imageUrl, status: "success", mime_type: uploaded.type, media_type: "image", type: "image",
        filename: uploaded.name, size: uploaded.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      counts.chats++; const body = JSON.parse(String(init.body)) as { scope: string; title: string };
      assert.equal(body.scope, "video"); assert.ok(body.title.startsWith("owner-runway-i2v-")); return json({ uuid: `runwaygen45sdkchat${counts.chats}` });
    }
    if (url.pathname.endsWith("/video/generate")) {
      counts.posts++; assert.equal(url.searchParams.get("ai_name"), "runway");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      const imageUrl = String((body.settings.file_urls as Array<{ url: string }>)[0]?.url);
      assert.deepEqual(body.settings, { model_type: MODEL, aspect_ratio: "169", video_duration: expectedDuration,
        seed: null, file_urls: [{ type: "image", url: imageUrl }] });
      assert.equal(body.chat_id, `runwaygen45sdkchat${counts.posts}`);
      operations.set(body.chat_id, { prompt: body.prompt, imageUrl, duration: expectedDuration,
        outputUrl: `https://r2.syntx.ai/runway-gen45-sdk2339/result-${counts.posts}.mp4` });
      return json({ id: `owner-${counts.posts}` });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(runwaygen45sdkchat\d+)\/messages$/u);
    if (history) {
      counts.histories++; const operation = operations.get(history[1]!); assert.ok(operation);
      const n = Number(history[1]!.replace("runwaygen45sdkchat", ""));
      const owner = { id: `owner-${n}`, chat_id: `provider-${n}`, author_id: 42, message_object: [
        { id: `prompt-${n}`, message_id: `owner-${n}`, object_type: "text", object_text: operation.prompt },
        { id: `image-${n}`, message_id: `owner-${n}`, object_type: "image", model_type: MODEL, object_url: operation.imageUrl }
      ] };
      const bot = { id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
        { id: `video-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: operation.outputUrl, model_type: MODEL, completed: true }
      ] };
      return json({ messages: [owner, bot], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detail = url.pathname.match(/^\/api\/v1\/chats\/(runwaygen45sdkchat\d+)\/bot-(\d+)$/u);
    if (detail) {
      counts.details++; const operation = operations.get(detail[1]!); assert.ok(operation);
      const n = Number(detail[1]!.replace("runwaygen45sdkchat", ""));
      return json({ id: `bot-${n}`, chat_id: `provider-${n}`, author_id: -1, message_object: [
        { id: `video-${n}`, message_id: `bot-${n}`, object_type: "video", object_url: operation.outputUrl, model_type: MODEL, completed: true }
      ] });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const readClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const references = new OwnerRunwayI2vReferenceService({ binding, linkService: links, resolveClient: () => chatClient });
  const { catalog } = loadOwnerRunwayI2vRuntimeCatalog();
  const generation = new OwnerRunwayI2vGenerationService({ binding, linkService: links, referenceService: references, catalog,
    resolveChatClient: () => chatClient, createReadClient: readClient, now: () => now });
  const server = new McpServer({ name: "runway-gen45-sdk2339", version: "1" });
  registerSyntxOwnerRunwayI2vTools(server, { referenceService: references, generationService: generation });
  const client = new Client({ name: "runway-gen45-sdk2339-client", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), OWNER_RUNWAY_I2V_TOOL_NAMES);
    for (const [duration, sourceValue] of [[5, "5.0"], [8, "8.0"], [10, "10.0"]] as const) {
      expectedDuration = sourceValue;
      const upload = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT,
        model_id: MODEL, aspect_ratio: "16:9", filename: "frame.png", mime_type: "image/png", content_base64: png16x9().toString("base64") } });
      assert.equal(upload.isError, undefined, JSON.stringify(upload));
      const reference_handle = (upload.structuredContent as { reference_handle: string }).reference_handle;
      const result = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
        model_id: MODEL, prompt: `Gen4.5 moving-clock case ${duration}.`, aspect_ratio: "16:9", video_duration: duration,
        seed: null, reference_handle } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal((result.structuredContent as { status: string }).status, "completed");
      assert.equal((result.structuredContent as { model_id: string }).model_id, MODEL);
      assert.equal((result.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
    }
    assert.deepEqual(counts, { uploads: 3, chats: 3, posts: 3, quotes: 6, balances: 6, subscriptions: 6, histories: 3, details: 3 });
  } finally { await client.close(); await server.close(); await generation.close(); await references.close(); }
});
