import assert from "node:assert/strict";
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
import { OwnerHailuoInitialGenerationService, loadOwnerHailuoInitialRuntimeCatalog } from "../src/application/owner-hailuo-initial-generation-service.js";
import { OwnerHailuoInitialImageVault } from "../src/application/owner-hailuo-initial-image-vault.js";
import { OWNER_HAILUO_INITIAL_TOOL_NAMES, registerSyntxOwnerHailuoInitialTools } from "../src/mcp/owner-hailuo-initial-tools.js";

const ATTEMPT = "link_hailuo_numeric2354_owner_0123456789abcdef";
const INPUT_URL = "https://r2.syntx.ai/hailuo-numeric2354/input.png";
const OUTPUT_URL = "https://r2.syntx.ai/hailuo-numeric2354/result.mp4";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function crc32(data: Uint8Array): number { let crc = 0xffff_ffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); } return (crc ^ 0xffff_ffff) >>> 0; }
function png(): Buffer { const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes; }

test("2354 Hailuo history/detail safely normalize numeric provider IDs while preserving ownership bindings", async () => {
  let now = Date.parse("2026-10-19T00:00:00.000Z");
  const binding = Object.freeze({ tenant_id: "hailuo-numeric2354", subject: "synthetic-owner" });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "hailuo-numeric2354", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-hailuo-numeric2354-credential" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const counts = { uploads: 0, chats: 0, posts: 0, histories: 0, details: 0, balances: 0, subscriptions: 0, quotes: 0 };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("user/balance")) { counts.balances++; return json({ balance: "100" }); }
    if (url.pathname.endsWith("user/subscription")) { counts.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) { counts.quotes++; return json({ access: true, cost: 0.25, discount_cost: null,
      free_remaining_generations: 0, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("chats/upload-files")) { counts.uploads++; const file = (init.body as FormData).get("files"); assert.ok(file instanceof File);
      return json({ files: [{ url: INPUT_URL, status: "success", mime_type: file.type,
        media_type: "image", type: "image", filename: file.name, size: file.size }] }); }
    if (url.pathname === "/api/v1/chats") { counts.chats++; return json({ uuid: "hailuo-numeric-chat" }); }
    if (url.pathname.endsWith("video/generate")) { counts.posts++; return json({ id: "42" }); }
    if (url.pathname.endsWith("/hailuo-numeric-chat/messages") && init.method === "GET") {
      counts.histories++;
      return json({ messages: [
        { id: 42, chat_id: 77202, author_id: 17, message_object: [
          { id: 501, message_id: 42, object_type: "text", object_text: "A calm portrait with subtle movement." },
          { id: 502, message_id: 42, object_type: "image", object_url: INPUT_URL, model_type: "hailuo-2.3-fast" }
        ] },
        { id: 51, chat_id: 77202, author_id: -1, message_object: [
          { id: 901, message_id: 51, object_type: "video", object_url: OUTPUT_URL, model_type: "hailuo-2.3-fast", completed: true }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/hailuo-numeric-chat/51" && init.method === "GET") {
      counts.details++; return json({ id: "51", chat_id: "77202", author_id: -1, message_object: [
        { id: "901", message_id: "51", object_type: "video", object_url: OUTPUT_URL, model_type: "hailuo-2.3-fast", completed: true }
      ] });
    }
    throw new Error(`Unexpected numeric-ID fixture route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const imageVault = new OwnerHailuoInitialImageVault({ binding, linkService: links, resolveChatClient: () => chatClient,
    uploadDestination: "hidden", now: () => now });
  const catalog = loadOwnerHailuoInitialRuntimeCatalog(join(process.cwd(), "catalog")).catalog;
  const service = new OwnerHailuoInitialGenerationService({ binding, linkService: links, imageVault, catalog,
    resolveChatClient: () => chatClient, createReadClient, now: () => now, catalogDirectory: join(process.cwd(), "catalog") });
  const server = new McpServer({ name: "hailuo-numeric2354", version: "1" }), client = new Client({ name: "hailuo-numeric2354-client", version: "1" });
  registerSyntxOwnerHailuoInitialTools(server, { imageVault, generationService: service });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const uploaded = await client.callTool({ name: OWNER_HAILUO_INITIAL_TOOL_NAMES[0], arguments: { link_attempt_id: ATTEMPT,
      model_id: "hailuo-2.3-fast", filename: "frame.png", mime_type: "image/png", content_base64: png().toString("base64") } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    const reference_handle = (uploaded.structuredContent as { reference_handle: string }).reference_handle;
    const result = await client.callTool({ name: OWNER_HAILUO_INITIAL_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
      model_id: "hailuo-2.3-fast", prompt: "A calm portrait with subtle movement.", resolution: "768p", video_duration: 6, reference_handle } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const value = result.structuredContent as { status: string; observed_artifact_count: number; artifacts: Array<{message_id:string;message_object_id:string;object_url:string}> };
    assert.equal(value.status, "completed"); assert.equal(value.observed_artifact_count, 1);
    assert.equal(value.artifacts[0]?.message_id, "51"); assert.equal(value.artifacts[0]?.message_object_id, "901");
    assert.equal(value.artifacts[0]?.object_url, OUTPUT_URL);
    assert.deepEqual(counts, { uploads: 1, chats: 1, posts: 1, histories: 1, details: 1, balances: 2, subscriptions: 2, quotes: 2 });
  } finally { await client.close(); await server.close(); await service.close(); await imageVault.close(); }
});
