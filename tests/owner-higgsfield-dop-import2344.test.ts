import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OwnerHiggsfieldDopGenerationService, loadOwnerHiggsfieldDopRuntimeCatalog } from "../src/application/owner-higgsfield-dop-generation-service.js";
import { OwnerHiggsfieldDopImportService } from "../src/application/owner-higgsfield-dop-import-service.js";
import { OwnerHiggsfieldDopMotionService } from "../src/application/owner-higgsfield-dop-motion-service.js";
import { OwnerHiggsfieldDopReferenceService } from "../src/application/owner-higgsfield-dop-reference-service.js";
import { registerSyntxOwnerHiggsfieldDopTools } from "../src/mcp/owner-higgsfield-dop-tools.js";

const ATTEMPT = "link_dop_import2344_owner_0123456789abcdef";
const FILE_ID = "120034567890";
const INPUT_URL = "https://r2.syntx.ai/dop-import2344/owned.png";
const OUTPUT_URL = "https://r2.syntx.ai/dop-import2344/result.mp4";
const MODEL = "dop-lite" as const;
const MOTIONS = Object.freeze([Object.freeze({ id: "orbit-soft", label: "Soft orbit", strength: 1 as const })]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width = 90, height = 160): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}

type InventoryMode = "matching" | "missing" | "duplicate" | "unsafe-url" | "different-bytes";
async function fixture(mode: InventoryMode = "matching") {
  let now = Date.parse("2026-10-19T14:00:00.000Z"), ready = true, last: Record<string, unknown> | undefined;
  const binding = Object.freeze({ tenant_id: "dop-import2344", subject: `owner-${Math.random().toString(16).slice(2)}` });
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "dop-import2344", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-dop-import2344-credential" }); return { state: "LINKED" }; }
  }, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);

  const stats = { inventory: 0, objectReads: 0, uploads: 0, chats: 0, posts: 0, quotes: 0, motions: 0, histories: 0, results: 0, balances: 0, subscriptions: 0 };
  const bytes = png(), mismatchBytes = Buffer.from(png()); mismatchBytes[37] = mismatchBytes[37]! ^ 1;
  const safeUrl = mode === "unsafe-url" ? "https://attacker.invalid/owned.png" : INPUT_URL;
  const item = { created_at: "2026-10-19T13:00:00.000Z", hash: "uninterpreted-upstream-hash", id: Number(FILE_ID),
    metadata: {}, model_type: "dop-lite", type: "image", updated_at: "2026-10-19T13:00:00.000Z", url: safeUrl };
  const itemRows = mode === "missing" ? [{ ...item, id: Number(FILE_ID) + 1 }] : mode === "duplicate" ? [item, { ...item }] : [item];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === "https://r2.syntx.ai") {
      stats.objectReads++;
      assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      const headers = new Headers(init.headers); assert.equal(headers.has("authorization"), false); assert.equal(headers.has("cookie"), false);
      return new Response(new Uint8Array(mode === "different-bytes" ? mismatchBytes : bytes), { status: 200,
        headers: { "content-type": "image/png", "content-length": String((mode === "different-bytes" ? mismatchBytes : bytes).byteLength) } });
    }
    assert.equal(url.origin, "https://api.syntx.ai");
    const headers = new Headers(init.headers);
    if (url.pathname === "/api/v1/higgsfield/motions") { stats.motions++; assert.equal(init.method, "GET");
      return json([{ id: MOTIONS[0]!.id, title: MOTIONS[0]!.label, preview_uri: "https://cdn.invalid/private-preview.webp" }]); }
    if (url.pathname.endsWith("files/uploaded")) {
      stats.inventory++; assert.equal(init.method, "GET"); assert.ok(headers.has("authorization"));
      assert.deepEqual(Object.fromEntries(url.searchParams), { scope: "all", page: "1", page_size: "10" });
      return json({ page: 1, page_size: 10, has_more: true, total: 1_402, items: itemRows });
    }
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "10.25" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) { stats.quotes++; return json({ access: true, cost: 0.2, discount_cost: null,
      free_remaining_generations: 0, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("chats/upload-files")) { stats.uploads++; throw new Error("import must never reupload"); }
    if (url.pathname === "/api/v1/chats") { stats.chats++; return json({ uuid: "dopimportchat2344" }); }
    if (url.pathname.endsWith("video/generate")) { stats.posts++; last = JSON.parse(String(init.body)) as Record<string, unknown>; return json({ id: "dopimportowner2344" }); }
    if (url.pathname.endsWith("/messages")) { stats.histories++; const owner = { id: "dopimportowner2344", chat_id: "dopimportprovider", author_id: 17,
      message_object: [{ id: "dopimporttext", message_id: "dopimportowner2344", object_type: "text", object_text: last?.prompt },
        { id: "dopimportimage", message_id: "dopimportowner2344", object_type: "image", object_url: INPUT_URL, model_type: MODEL }] };
      const bot = { id: "dopimportbot2344", chat_id: "dopimportprovider", author_id: -1,
        message_object: [{ id: "dopimportvideo", message_id: "dopimportbot2344", object_type: "video", object_url: OUTPUT_URL, model_type: MODEL, completed: true }] };
      const messages = [owner, ...(ready ? [bot] : [])]; return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } }); }
    if (url.pathname.endsWith("/dopimportbot2344")) { stats.results++; return json({ id: "dopimportbot2344", chat_id: "dopimportprovider", author_id: -1,
      message_object: [{ id: "dopimportvideo", message_id: "dopimportbot2344", object_type: "video", object_url: OUTPUT_URL, model_type: MODEL, completed: true }] }); }
    throw new Error(`Unexpected route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const references = new OwnerHiggsfieldDopReferenceService({ binding, linkService: links, resolveClient: () => chatClient,
    uploadDestination: "uploaded", now: () => now });
  const importer = new OwnerHiggsfieldDopImportService(references);
  const motionService = new OwnerHiggsfieldDopMotionService({ binding, linkService: links, createReadClient });
  const { catalog } = loadOwnerHiggsfieldDopRuntimeCatalog();
  const generation = new OwnerHiggsfieldDopGenerationService({ binding, linkService: links, referenceService: references,
    catalog, resolveChatClient: () => chatClient, createReadClient, now: () => now });
  return { bytes, stats, importer, references, motionService, generation,
    async close() { await generation.close(); await references.close(); await motionService.close(); } };
}

test("2344 imports an existing owned DOP image by exact inventory id and only generates after an explicit second tool call", async () => {
  const env = await fixture(), server = new McpServer({ name: "dop-import2344", version: "1" });
  registerSyntxOwnerHiggsfieldDopTools(server, { referenceService: env.references, importService: env.importer,
    motionService: env.motionService, generationService: env.generation });
  const client = new Client({ name: "dop-import2344-client", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("syntx_owner_import_higgsfield_dop_image"));
    const imported = await client.callTool({ name: "syntx_owner_import_higgsfield_dop_image", arguments: {
      link_attempt_id: ATTEMPT, model_id: MODEL, filename: "owned.png", mime_type: "image/png", content_base64: env.bytes.toString("base64"), file_id: FILE_ID, destination: "uploaded"
    } });
    assert.equal(imported.isError, undefined);
    const output = imported.structuredContent as Record<string, unknown>;
    assert.equal(output.status, "imported"); assert.equal(output.provenance, "OWNED_EXISTING_ACCOUNT_ASSET");
    assert.equal(output.generation_permit, false); assert.equal(JSON.stringify(imported).includes(INPUT_URL), false);
    assert.equal(env.stats.inventory, 1); assert.equal(env.stats.objectReads, 1); assert.equal(env.stats.uploads, 0);
    assert.equal(env.stats.chats, 0); assert.equal(env.stats.posts, 0);
    const generated = await client.callTool({ name: "syntx_owner_generate_higgsfield_dop_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: MODEL, prompt: "Animate this portrait carefully.", enhance_prompt: false, motions: MOTIONS,
      reference_handle: output.reference_handle
    } });
    assert.equal(generated.isError, undefined); assert.equal((generated.structuredContent as { status: string }).status, "completed");
    assert.equal(env.stats.inventory, 1); assert.equal(env.stats.objectReads, 1); assert.equal(env.stats.uploads, 0); assert.equal(env.stats.posts, 1);
  } finally { await client.close(); await server.close(); await env.close(); }
});

test("2344 missing, duplicate, unsafe and byte-mismatched inventory entries fail closed without upload or generation", async () => {
  for (const mode of ["missing", "duplicate", "unsafe-url", "different-bytes"] as const) {
    const env = await fixture(mode);
    try {
      await assert.rejects(env.importer.importExisting({ attemptId: ATTEMPT, model_id: MODEL, filename: "owned.png",
        mime_type: "image/png", bytes: env.bytes, file_id: FILE_ID, destination: "uploaded" }));
      assert.equal(env.stats.uploads, 0); assert.equal(env.stats.chats, 0); assert.equal(env.stats.posts, 0);
      assert.equal(env.stats.objectReads, mode === "missing" || mode === "duplicate" || mode === "unsafe-url" ? 0 : 1);
    } finally { await env.close(); }
  }
});
