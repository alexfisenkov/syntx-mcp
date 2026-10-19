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
import { OwnerHiggsfieldDopGenerationService } from "../src/application/owner-higgsfield-dop-generation-service.js";
import { OwnerHiggsfieldDopImportService } from "../src/application/owner-higgsfield-dop-import-service.js";
import { OwnerHiggsfieldDopMotionService } from "../src/application/owner-higgsfield-dop-motion-service.js";
import { OwnerHiggsfieldDopReferenceService } from "../src/application/owner-higgsfield-dop-reference-service.js";
import { loadOwnerHiggsfieldDopRuntimeCatalog } from "../src/application/owner-higgsfield-dop-generation-service.js";
import { registerSyntxOwnerHiggsfieldDopTools, OWNER_HIGGSFIELD_DOP_TOOL_NAMES } from "../src/mcp/owner-higgsfield-dop-tools.js";
import { createOwnerHiggsfieldDopRuntime } from "../src/runtime/owner-higgsfield-dop-runtime.js";
import { readOwnerHiggsfieldDopFlag, readOwnerHiggsfieldDopOperatorConfiguration } from "../src/runtime/owner-higgsfield-dop-stdio-config.js";

const ATTEMPT = "link_higgsfield_dop2312_owner_0123456789abcdef";
const OTHER_ATTEMPT = "link_higgsfield_dop2312_other_0123456789abcdef";
const INPUT_URL = "https://r2.syntx.ai/higgsfield-dop2312/input.png";
const OUTPUT_URL = "https://r2.syntx.ai/higgsfield-dop2312/result.mp4";
const OWNER_TITLE_PREFIX = "owner-higgsfield-dop-";
const MODEL_IDS = ["dop-lite", "dop-turbo"] as const;
const MOTIONS = Object.freeze([Object.freeze({ id: 17, label: "Soft orbit", strength: 1 as const })]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png(width = 90, height = 160): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

test("2312 destination configuration is default-off and requires an explicit trusted choice when enabled", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHiggsfieldDopFlag(value), false);
  assert.equal(readOwnerHiggsfieldDopFlag("1"), true);
  for (const value of [true, "true", "yes", "2"]) assert.throws(() => readOwnerHiggsfieldDopFlag(value));
  assert.equal(readOwnerHiggsfieldDopOperatorConfiguration(false, undefined), undefined);
  assert.equal(readOwnerHiggsfieldDopOperatorConfiguration(false, "invalid"), undefined);
  assert.deepEqual(readOwnerHiggsfieldDopOperatorConfiguration(true, "uploaded"), { uploadDestination: "uploaded" });
  assert.deepEqual(readOwnerHiggsfieldDopOperatorConfiguration(true, "hidden"), { uploadDestination: "hidden" });
  for (const value of [undefined, "", "public", true]) assert.throws(() => readOwnerHiggsfieldDopOperatorConfiguration(true, value));
});

type FlowOptions = Readonly<{ free?: boolean; secondDenied?: boolean; loseAck?: boolean; pending?: boolean; wrongOwner?: boolean; wrongModel?: boolean }>;
async function fixture(options: FlowOptions = {}) {
  let now = Date.parse("2026-10-19T00:00:00.000Z"), attemptIndex = 0, ready = !options.pending;
  const binding = Object.freeze({ tenant_id: "higgsfield-dop2312", subject: `owner-${Math.random().toString(16).slice(2)}` });
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "higgsfield-dop2312", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-higgsfield-dop2312-credential" }); return { state: "LINKED" }; }
  }, new InMemoryAuthLinkStore(() => now), { now: () => now,
    attemptIdGenerator: () => [ATTEMPT, OTHER_ATTEMPT][attemptIndex++]! });
  for (const attempt of [ATTEMPT, OTHER_ATTEMPT]) { await links.createAttempt(binding); await links.issueHandoff(binding, attempt); await links.checkAttempt(binding, attempt); }

  const stats = { uploads: 0, chats: 0, posts: 0, quotes: 0, motions: 0, histories: 0, results: 0, balances: 0, subscriptions: 0 };
  let last: Record<string, unknown> | undefined;
  let lastModelId: string | undefined;
  let capturedUpload: { destination: string; model_type: string; bytes: Buffer } | undefined;
  const owner = (model_id: string) => ({ id: "owner2312", chat_id: "provider2312", author_id: options.wrongOwner ? -1 : 17,
    message_object: [
      { id: "prompt2312", message_id: "owner2312", object_type: "text", object_text: last?.prompt },
      { id: "image2312", message_id: "owner2312", object_type: "image", object_url: INPUT_URL,
        model_type: options.wrongModel ? "dop-lite" : model_id }
    ] });
  const bot = (model_id: string) => ({ id: "bot2312", chat_id: "provider2312", author_id: -1, message_object: [
    { id: "video2312", message_id: "bot2312", object_type: "video", object_url: OUTPUT_URL,
      model_type: model_id, completed: true }
  ] });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname === "/api/v1/higgsfield/motions") {
      stats.motions++; assert.equal(init.method, "GET"); assert.equal(url.search, "");
      return json([{ id: MOTIONS[0]!.id, title: MOTIONS[0]!.label, preview_uri: "https://cdn.invalid/private-preview.webp" }]);
    }
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "10.25" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: options.free ? "FREE" : "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++;
      assert.equal(url.searchParams.get("ai_name"), "higgsfield");
      assert.ok(MODEL_IDS.includes(url.searchParams.get("model_type") as typeof MODEL_IDS[number]));
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type"]);
      return json({ access: !(options.secondDenied && stats.quotes === 2), cost: 0.2, discount_cost: null,
        free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      stats.uploads++;
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      capturedUpload = { destination: String(form.get("destination")), model_type: String(form.get("model_type")), bytes: Buffer.from(await file.arrayBuffer()) };
      return json({ files: [{ url: INPUT_URL, status: "success", mime_type: file.type, media_type: "image", type: "image",
        filename: file.name, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      stats.chats++; const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.scope, "video"); assert.equal(typeof body.title, "string");
      assert.ok(String(body.title).startsWith(OWNER_TITLE_PREFIX)); return json({ uuid: `dopchat${stats.chats}` });
    }
    if (url.pathname.endsWith("video/generate")) {
      stats.posts++; last = JSON.parse(String(init.body)) as Record<string, unknown>;
      const model = ((last.settings as Record<string, unknown>).model_type as string); lastModelId = model;
      assert.equal(url.searchParams.get("ai_name"), "higgsfield");
      assert.deepEqual([...url.searchParams.keys()], ["ai_name"]);
      assert.equal(last.chat_id, `dopchat${stats.chats}`); assert.equal("chat_uuid" in last, false);
      assert.deepEqual((JSON.parse(String(init.body)) as { settings: unknown }).settings, {
        model_type: model, enhance_prompt: false, motions: MOTIONS, file_urls: [{ type: "image", url: INPUT_URL }]
      });
      if (options.loseAck) throw new Error("synthetic lost generation ACK");
      return json({ id: "owner2312" });
    }
    if (url.pathname.endsWith(`/dopchat${stats.chats}/messages`)) {
      stats.histories++; const model = lastModelId ?? "dop-lite";
      const messages = [owner(model), ...(ready ? [bot(model)] : [])];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith(`/dopchat${stats.chats}/bot2312`)) { stats.results++; return json(bot(lastModelId ?? "dop-lite")); }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  };

  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const references = new OwnerHiggsfieldDopReferenceService({ binding, linkService: links, resolveClient: () => chatClient,
    uploadDestination: "hidden", now: () => now });
  const importer = new OwnerHiggsfieldDopImportService(references);
  const motionService = new OwnerHiggsfieldDopMotionService({ binding, linkService: links, createReadClient });
  const { catalog } = loadOwnerHiggsfieldDopRuntimeCatalog();
  const generation = new OwnerHiggsfieldDopGenerationService({ binding, linkService: links, referenceService: references,
    catalog, resolveChatClient: () => chatClient, createReadClient, now: () => now });
  const bytes = png();
  return { binding, links, chatClient, references, importer, motionService, generation, bytes, stats, capturedUpload: () => capturedUpload,
    ready: () => { ready = true; }, async close() { await generation.close(); await references.close(); await motionService.close(); } };
}

test("2312 exact upload, two fresh empty-key quotes, one POST, owned history, and detail GET for both models", async () => {
  const env = await fixture();
  try {
    for (const model_id of MODEL_IDS) {
      const image = await env.references.uploadReference({ attemptId: ATTEMPT, model_id, filename: "frame.png", mime_type: "image/png", bytes: env.bytes });
      const result = await env.generation.generate({ attemptId: ATTEMPT, model_id, prompt: "Animate this portrait carefully.",
        enhance_prompt: false, motions: MOTIONS, reference_handle: image.reference_handle });
      assert.equal(result.status, "completed"); assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL);
      assert.equal(result.model_id, model_id); assert.equal(result.cost_cap_enforced, false);
      assert.equal(result.backend_acceptance, "UNPROVEN");
    }
    assert.equal(env.stats.uploads, 2); assert.equal(env.stats.chats, 2); assert.equal(env.stats.posts, 2);
    assert.equal(env.stats.quotes, 4); assert.equal(env.stats.balances, 4); assert.equal(env.stats.subscriptions, 4);
    assert.equal(env.stats.motions, 4);
    assert.equal(env.stats.histories, 2); assert.equal(env.stats.results, 2);
    assert.equal(env.capturedUpload()?.destination, "hidden"); assert.equal(env.capturedUpload()?.model_type, "dop-turbo");
  } finally { await env.close(); }
});

test("2312 allows duplicate-URL reuse across DOP IDs only for identical image bytes", async () => {
  const env = await fixture();
  try {
    const first = await env.references.uploadReference({ attemptId: ATTEMPT, model_id: "dop-lite", filename: "frame.png", mime_type: "image/png", bytes: env.bytes });
    const second = await env.references.uploadReference({ attemptId: ATTEMPT, model_id: "dop-turbo", filename: "frame.png", mime_type: "image/png", bytes: env.bytes });
    assert.equal(first.reference_handle === second.reference_handle, false);
    assert.equal(env.references.isOwnedReference(await env.references.resolveReference({ attemptId: ATTEMPT, model_id: "dop-lite", reference_handle: first.reference_handle })), true);
    assert.equal(env.references.isOwnedReference(await env.references.resolveReference({ attemptId: ATTEMPT, model_id: "dop-turbo", reference_handle: second.reference_handle })), true);
    await assert.rejects(env.references.uploadReference({ attemptId: ATTEMPT, model_id: "dop-lite", filename: "different.png",
      mime_type: "image/png", bytes: png(91, 160) }), { code: "UPLOAD_OUTCOME_UNKNOWN" });
    await assert.rejects(env.references.resolveReference({ attemptId: ATTEMPT, model_id: "dop-lite", reference_handle: first.reference_handle }),
      { code: "REFERENCE_UNAVAILABLE" });
    assert.equal(env.stats.uploads, 3);
  } finally { await env.close(); }
});

test("2312 denied second quote or lost generation ACK never causes a second GEN", async () => {
  for (const options of [{ secondDenied: true }, { loseAck: true, pending: true }]) {
    const env = await fixture(options);
    try {
      const upload = await env.references.uploadReference({ attemptId: ATTEMPT, model_id: "dop-lite", filename: "frame.png", mime_type: "image/png", bytes: env.bytes });
      const request = { attemptId: ATTEMPT, model_id: "dop-lite", prompt: "Animate this portrait carefully.",
        enhance_prompt: false, motions: MOTIONS, reference_handle: upload.reference_handle };
      if (options.secondDenied) {
        await assert.rejects(env.generation.generate(request)); assert.equal(env.stats.posts, 0);
      } else {
        const unknown = await env.generation.generate(request); assert.equal(unknown.status, "outcome_unknown");
        env.ready();
        await env.generation.reconcile({ attemptId: ATTEMPT, recovery_id: unknown.recovery_id });
        await assert.rejects(env.generation.generate(request), { code: "INTENT_ALREADY_CLAIMED" });
        assert.equal(env.stats.posts, 1);
      }
    } finally { await env.close(); }
  }
});

test("2312 rejects a motion ID or label absent from the fresh catalogue before chat and GEN", async () => {
  const env = await fixture();
  try {
    const upload = await env.references.uploadReference({ attemptId: ATTEMPT, model_id: "dop-lite", filename: "frame.png",
      mime_type: "image/png", bytes: env.bytes });
    for (const id of [999, "17"] as const) {
      await assert.rejects(env.generation.generate({ attemptId: ATTEMPT, model_id: "dop-lite", prompt: "Animate this portrait carefully.",
        enhance_prompt: false, motions: [{ id, label: "Soft orbit", strength: 1 }], reference_handle: upload.reference_handle }),
        { code: "PREFLIGHT_FAILED" });
    }
    assert.equal(env.stats.motions, 2); assert.equal(env.stats.chats, 0); assert.equal(env.stats.posts, 0);
  } finally { await env.close(); }
});

test("2312 full MCP route lists only DOP tools and keeps owner-only inputs/source-only claims", async () => {
  const env = await fixture();
  const server = new McpServer({ name: "higgsfield-dop2312-tools", version: "1" });
  registerSyntxOwnerHiggsfieldDopTools(server, { referenceService: env.references, importService: env.importer,
    motionService: env.motionService, generationService: env.generation });
  const client = new Client({ name: "higgsfield-dop2312-client", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), OWNER_HIGGSFIELD_DOP_TOOL_NAMES);
    const motions = await client.callTool({ name: OWNER_HIGGSFIELD_DOP_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(motions.isError, undefined);
    assert.equal(JSON.stringify(motions).includes("cdn.invalid"), false);
    assert.deepEqual((motions.structuredContent as { motions: unknown }).motions, MOTIONS);
    const uploaded = await client.callTool({ name: OWNER_HIGGSFIELD_DOP_TOOL_NAMES[0], arguments: {
      link_attempt_id: ATTEMPT, model_id: "dop-lite", filename: "frame.png", mime_type: "image/png", content_base64: env.bytes.toString("base64")
    } });
    assert.equal(uploaded.isError, undefined); assert.equal(JSON.stringify(uploaded).includes(INPUT_URL), false);
    const handle = (uploaded.structuredContent as { reference_handle: string }).reference_handle;
    const generated = await client.callTool({ name: OWNER_HIGGSFIELD_DOP_TOOL_NAMES[3], arguments: {
      link_attempt_id: ATTEMPT, model_id: "dop-lite", prompt: "Animate this portrait carefully.", enhance_prompt: false, motions: MOTIONS, reference_handle: handle
    } });
    assert.equal(generated.isError, undefined);
    assert.equal((generated.structuredContent as { status: string }).status, "completed");
    assert.equal((generated.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
    const other = await client.callTool({ name: OWNER_HIGGSFIELD_DOP_TOOL_NAMES[3], arguments: {
      link_attempt_id: OTHER_ATTEMPT, model_id: "dop-lite", prompt: "Animate this portrait carefully.", enhance_prompt: false, motions: MOTIONS, reference_handle: handle
    } });
    assert.equal(other.isError, true);
    assert.equal(env.stats.posts, 1);
  } finally { await client.close(); await server.close(); await env.close(); }
});

test("2312 owner runtime composes without network and invalidates its own process-local lifecycle", async () => {
  const env = await fixture();
  let networkCalls = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "runtime", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge() { return { state: "LINKED" }; }
  };
  const runtimeLinks = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => Date.now()));
  const runtime = createOwnerHiggsfieldDopRuntime({ binding: env.binding, linkService: runtimeLinks,
    createReadClient: () => new SyntxHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) { return use("unused"); } },
      fetchImpl: async () => { networkCalls++; throw new Error("network forbidden"); } }),
    createChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) { return use("unused"); } },
      fetchImpl: async () => { networkCalls++; throw new Error("network forbidden"); } }),
    uploadDestination: "hidden", now: Date.now });
  try {
    await runtime.lifecycle.invalidateAttempt(ATTEMPT);
    assert.equal(networkCalls, 0);
  } finally { await runtime.lifecycle.close(); await env.close(); }
});
