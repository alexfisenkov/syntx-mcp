import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OwnerHailuoInitialGenerationService, loadOwnerHailuoInitialRuntimeCatalog } from "../src/application/owner-hailuo-initial-generation-service.js";
import { OwnerHailuoInitialImageVault } from "../src/application/owner-hailuo-initial-image-vault.js";
import { createOwnerHailuoInitialRuntime, settleOwnerHailuoInitialClosures } from "../src/runtime/owner-hailuo-initial-runtime.js";
import { readOwnerHailuoInitialFlag, readOwnerHailuoInitialOperatorConfiguration } from "../src/runtime/owner-hailuo-initial-stdio-config.js";

const ATTEMPT = "link_hailuo2316_owner_0123456789abcdef";
const INPUT_URL = "https://r2.syntx.ai/hailuo2316/input.png";
const OUTPUT_URL = "https://r2.syntx.ai/hailuo2316/result.mp4";
const MODELS = ["hailuo-2.3-fast", "hailuo-01-live-character", "hailuo-3.0"] as const;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
let fixtureSequence = 0;

function png(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function request(model_id: typeof MODELS[number]) {
  if (model_id === "hailuo-01-live-character") return { model_id, prompt: "A quiet moving portrait.", resolution: "720p", video_duration: 6 };
  if (model_id === "hailuo-2.3-fast") return { model_id, prompt: "A quiet moving portrait.", resolution: "768p", video_duration: 6 };
  return { model_id, prompt: "A quiet moving portrait.", resolution: "2K", video_duration: 5, aspect_ratio: "16:9", mode: "omni-references" };
}

async function fixture(options: { secondQuoteDenied?: boolean; loseAck?: boolean; advanceClockPerFetch?: boolean } = {}) {
  let now = Date.parse("2026-10-19T00:00:00.000Z"), ready = !options.loseAck, accountQuote = 0;
  fixtureSequence += 1;
  const binding = Object.freeze({ tenant_id: "hailuo2316", subject: "owner-hailuo2316-fixture-" + fixtureSequence });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "hailuo2316", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-hailuo2316-credential" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const stats = { uploads: 0, chats: 0, posts: 0, quotes: 0, histories: 0, results: 0, balances: 0, subscriptions: 0 };
  let body: Record<string, unknown> | undefined;
  const owner = (model_id: string) => ({ id: `owner-${stats.posts}`, chat_id: `provider-${stats.chats}`, author_id: 17,
    message_object: [{ id: `prompt-${stats.posts}`, message_id: `owner-${stats.posts}`, object_type: "text", object_text: body?.prompt },
      { id: `image-${stats.posts}`, message_id: `owner-${stats.posts}`, object_type: "image", object_url: INPUT_URL, model_type: model_id }] });
  const bot = (model_id: string) => ({ id: `bot-${stats.posts}`, chat_id: `provider-${stats.chats}`, author_id: -1,
    message_object: [{ id: `video-${stats.posts}`, message_id: `bot-${stats.posts}`, object_type: "video", object_url: OUTPUT_URL,
      model_type: model_id, completed: true }] });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    if (options.advanceClockPerFetch) now += 10;
    const url = new URL(String(input));
    if (url.pathname.endsWith("user/balance")) { stats.balances++; return json({ balance: "100" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscriptions++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++; accountQuote++;
      if (options.secondQuoteDenied && accountQuote === 2) return json({ access: false, cost: null, discount_cost: null,
        free_remaining_generations: 0, limit: null, show_warning: false });
      return json({ access: true, cost: 0.25, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      stats.uploads++; const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      return json({ files: [{ url: INPUT_URL, status: "success", mime_type: file.type, media_type: "image", type: "image",
        filename: file.name, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") { stats.chats++; return json({ uuid: `hailuo-chat-${stats.chats}` }); }
    if (url.pathname.endsWith("video/generate")) {
      stats.posts++; body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(url.searchParams.get("ai_name"), "hailuo-minimax");
      assert.equal(body.chat_id, `hailuo-chat-${stats.chats}`);
      const settings = body.settings as Record<string, unknown>;
      assert.ok(MODELS.includes(settings.model_type as typeof MODELS[number]));
      assert.deepEqual(settings.file_urls, [{ type: "image", url: INPUT_URL }]);
      if (settings.model_type === "hailuo-2.3-fast") assert.deepEqual(Object.keys(settings).sort(),
        ["file_urls", "model_type", "resolution", "video_duration"]);
      if (settings.model_type === "hailuo-01-live-character") assert.deepEqual(settings,
        { model_type: "hailuo-01-live-character", resolution: "720p", video_duration: 6, file_urls: [{ type: "image", url: INPUT_URL }] });
      if (settings.model_type === "hailuo-3.0") assert.deepEqual(settings,
        { model_type: "hailuo-3.0", resolution: "2K", video_duration: 5, aspect_ratio: "16:9", mode: "omni-references",
          file_urls: [{ type: "image", url: INPUT_URL }] });
      if (options.loseAck) throw new Error("synthetic lost ack");
      return json({ id: `owner-${stats.posts}` });
    }
    if (url.pathname.endsWith(`/hailuo-chat-${stats.chats}/messages`)) {
      stats.histories++; const settings = body?.settings as Record<string, unknown>;
      const model = String(settings?.model_type); const messages = [owner(model), ...(ready ? [bot(model)] : [])];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith(`/hailuo-chat-${stats.chats}/bot-${stats.posts}`)) {
      stats.results++; return json(bot(String((body?.settings as Record<string, unknown>).model_type)));
    }
    throw new Error(`Unexpected local fixture route ${url.pathname}`);
  };
  const credentialBroker = { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const catalog = loadOwnerHailuoInitialRuntimeCatalog().catalog;
  const vault = new OwnerHailuoInitialImageVault({ binding, linkService: links, resolveChatClient: () => chatClient,
    uploadDestination: "hidden", now: () => now });
  const generation = new OwnerHailuoInitialGenerationService({ binding, linkService: links, imageVault: vault, catalog,
    resolveChatClient: () => chatClient, createReadClient, now: () => now });
  return { binding, links, chatClient, vault, generation, stats, ready: () => { ready = true; },
    async close() { await generation.close(); await vault.close(); } };
}

test("2316 default-off runtime flag is independent and destination is trusted operator config", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHailuoInitialFlag(value), false);
  assert.equal(readOwnerHailuoInitialFlag("1"), true);
  assert.equal(readOwnerHailuoInitialOperatorConfiguration(false, undefined), undefined);
  assert.deepEqual(readOwnerHailuoInitialOperatorConfiguration(true, "hidden"), { uploadDestination: "hidden" });
  for (const value of [true, "yes", "2"]) assert.throws(() => readOwnerHailuoInitialFlag(value));
  assert.throws(() => readOwnerHailuoInitialOperatorConfiguration(true, "uploaded-by-caller"));
});

test("2316 runtime cleanup failure remains observable instead of resolving successfully", async () => {
  await assert.rejects(settleOwnerHailuoInitialClosures([async () => { throw new Error("cleanup failed"); }]),
    /cleanup failed/u);
});

test("2316 observed runtime MCP upload→generation→GET result crosses real SDK schemas", async () => {
  const binding = Object.freeze({ tenant_id: "hailuo2316-mcp", subject: "owner-hailuo2316-mcp" });
  let now = Date.parse("2026-10-19T00:00:00.000Z");
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "hailuo2316-mcp", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-hailuo2316-mcp-credential" }); return { state: "LINKED" }; }
  };
  const linking = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await linking.createAttempt(binding); await linking.issueHandoff(binding, ATTEMPT); await linking.checkAttempt(binding, ATTEMPT);
  const stats = { uploads: 0, chats: 0, posts: 0, balance: 0, subscription: 0, quotes: 0, history: 0, result: 0 };
  const inputUrl = "https://r2.syntx.ai/hailuo2316-sdk/input.png";
  const outputUrl = "https://r2.syntx.ai/hailuo2316-sdk/result.mp4";
  let submitted: Record<string, unknown> | undefined;
  let modelId = "hailuo-2.3-fast";
  const owner = () => ({ id: "hailuo-mcp-owner", chat_id: "provider-chat", author_id: 17, message_object: [
    { id: "hailuo-mcp-prompt", message_id: "hailuo-mcp-owner", object_type: "text", object_text: submitted?.prompt },
    { id: "hailuo-mcp-image", message_id: "hailuo-mcp-owner", object_type: "image", object_url: inputUrl, model_type: modelId }
  ] });
  const bot = () => ({ id: "hailuo-mcp-bot", chat_id: "provider-chat", author_id: -1, message_object: [
    { id: "hailuo-mcp-video", message_id: "hailuo-mcp-bot", object_type: "video", object_url: outputUrl,
      model_type: modelId, completed: true }
  ] });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("user/balance")) { stats.balance++; return json({ balance: "100" }); }
    if (url.pathname.endsWith("user/subscription")) { stats.subscription++; return json({ active: true, type: "PRO", end_date: "2099-01-01" }); }
    if (url.pathname.endsWith("get_model_info")) {
      stats.quotes++; assert.equal(url.searchParams.get("ai_name"), "hailuo-minimax");
      assert.equal(url.searchParams.get("model_type"), "hailuo-2.3-fast");
      assert.equal(url.searchParams.get("resolution"), "768p"); assert.equal(url.searchParams.get("video_duration"), "6");
      return json({ access: true, cost: 0.25, discount_cost: null, free_remaining_generations: 0, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("chats/upload-files")) {
      stats.uploads++; const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(String(form.get("destination")), "uploaded"); assert.equal(String(form.get("model_type")), "hailuo-2.3-fast");
      return json({ files: [{ url: inputUrl, status: "success", mime_type: file.type, media_type: "image", type: "image",
        filename: file.name, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") { stats.chats++; return json({ uuid: "hailuo-mcp-chat" }); }
    if (url.pathname.endsWith("video/generate")) {
      stats.posts++; submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(url.searchParams.get("ai_name"), "hailuo-minimax"); assert.equal(submitted.chat_id, "hailuo-mcp-chat");
      assert.deepEqual(submitted.settings, { model_type: "hailuo-2.3-fast", resolution: "768p", video_duration: 6,
        file_urls: [{ type: "image", url: inputUrl }] });
      return json({ id: "hailuo-mcp-owner" });
    }
    if (url.pathname.endsWith("/hailuo-mcp-chat/messages")) {
      stats.history++; modelId = String(((submitted?.settings ?? {}) as Record<string, unknown>).model_type);
      const messages = [owner(), bot()];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/hailuo-mcp-chat/hailuo-mcp-bot")) { stats.result++; return json(bot()); }
    throw new Error("Unexpected fake upstream route " + url.pathname);
  };
  const runtime = createObservedOwnerRuntime({ catalogDirectory: "catalog", authStore: store, authBinding: binding,
    ownerHailuoInitialEnabled: true, ownerHailuoInitialUploadDestination: "uploaded", fetchImpl, now: () => now });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "hailuo2316-sdk-consumer", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const listed = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(listed.includes("syntx_owner_upload_hailuo_initial_image"));
    assert.ok(listed.includes("syntx_owner_generate_hailuo_initial_video"));
    const uploaded = await client.callTool({ name: "syntx_owner_upload_hailuo_initial_image", arguments: {
      link_attempt_id: ATTEMPT, model_id: "hailuo-2.3-fast", filename: "frame.png", mime_type: "image/png", content_base64: png().toString("base64")
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    assert.equal(JSON.stringify(uploaded).includes(inputUrl), false);
    const handle = (uploaded.structuredContent as { reference_handle: string }).reference_handle;
    const generated = await client.callTool({ name: "syntx_owner_generate_hailuo_initial_video", arguments: {
      link_attempt_id: ATTEMPT, model_id: "hailuo-2.3-fast", prompt: "A calm portrait with subtle movement.",
      resolution: "768p", video_duration: 6, reference_handle: handle
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const result = generated.structuredContent as { status: string; artifacts: Array<{ object_url: string }>; gaps: string[]; backend_acceptance: string };
    assert.equal(result.status, "completed"); assert.deepEqual(result.artifacts.map(item => item.object_url), [outputUrl]);
    assert.deepEqual(result.gaps, []); assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.deepEqual(stats, { uploads: 1, chats: 1, posts: 1, balance: 2, subscription: 2, quotes: 2, history: 1, result: 1 });
  } finally {
    await client.close(); await server.close(); await runtime.ownerHailuoInitialLifecycle?.close(); store.close();
  }
});

test("2316 uses genuine one-image upload, two fresh account/quote checks, and exact child model tuples", async () => {
  const env = await fixture();
  try {
    for (const model_id of MODELS) {
      const uploaded = await env.vault.uploadReference({ attemptId: ATTEMPT, model_id, filename: "frame.png", mime_type: "image/png", bytes: png() });
      const result = await env.generation.generate({ attemptId: ATTEMPT, ...request(model_id), reference_handle: uploaded.reference_handle });
      assert.equal(result.status, "completed"); assert.equal(result.model_id, model_id); assert.equal(result.artifacts.length, 1);
      assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.cost_cap_enforced, false);
    }
    assert.deepEqual(env.stats, { uploads: 3, chats: 3, posts: 3, quotes: 6, histories: 3, results: 3, balances: 6, subscriptions: 6 });
  } finally { await env.close(); }
});

test("2343 validates both Hailuo quotes against the clock after asynchronous reads", async () => {
  const env = await fixture({ advanceClockPerFetch: true });
  try {
    const uploaded = await env.vault.uploadReference({ attemptId: ATTEMPT, model_id: "hailuo-2.3-fast", filename: "frame.png", mime_type: "image/png", bytes: png() });
    const result = await env.generation.generate({ attemptId: ATTEMPT, ...request("hailuo-2.3-fast"), reference_handle: uploaded.reference_handle });
    assert.equal(result.status, "completed");
    assert.deepEqual(env.stats, { uploads: 1, chats: 1, posts: 1, quotes: 2, histories: 1, results: 1, balances: 2, subscriptions: 2 });
  } finally { await env.close(); }
});

test("2316 denied second quote prevents dispatch without reusing a prior semantic claim", async () => {
  const env = await fixture({ secondQuoteDenied: true });
  try {
    const uploaded = await env.vault.uploadReference({ attemptId: ATTEMPT, model_id: "hailuo-2.3-fast", filename: "frame.png", mime_type: "image/png", bytes: png() });
    await assert.rejects(env.generation.generate({ attemptId: ATTEMPT, ...request("hailuo-2.3-fast"), prompt: "Denied quote isolation case.",
      reference_handle: uploaded.reference_handle }), { code: "PREFLIGHT_FAILED" });
    assert.equal(env.stats.quotes, 2, "first fresh quote succeeded and the second quote was denied");
    assert.equal(env.stats.balances, 2); assert.equal(env.stats.subscriptions, 2);
    assert.equal(env.stats.posts, 0); assert.equal(env.stats.chats, 1);
  } finally { await env.close(); }
});

test("2316 lost acknowledgement remains sticky and reconciliation uses GET only", async () => {
  const env = await fixture({ loseAck: true });
  try {
    const uploaded = await env.vault.uploadReference({ attemptId: ATTEMPT, model_id: "hailuo-3.0", filename: "frame.png", mime_type: "image/png", bytes: png() });
    const input = { attemptId: ATTEMPT, ...request("hailuo-3.0"), reference_handle: uploaded.reference_handle };
    const unknown = await env.generation.generate(input);
    assert.equal(unknown.status, "outcome_unknown"); env.ready();
    await env.generation.reconcile({ attemptId: ATTEMPT, recovery_id: unknown.recovery_id });
    await assert.rejects(env.generation.generate(input), { code: "INTENT_ALREADY_CLAIMED" });
    assert.equal(env.stats.posts, 1);
  } finally { await env.close(); }
});

test("2316 runtime composes without network and invalidates only its own client lifecycle", async () => {
  const env = await fixture(); let networkCalls = 0;
  const runtime = createOwnerHailuoInitialRuntime({ binding: env.binding, linkService: env.links,
    createReadClient: () => new SyntxHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) { return use("unused"); } },
      fetchImpl: async () => { networkCalls++; throw new Error("network forbidden"); } }),
    createChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) { return use("unused"); } },
      fetchImpl: async () => { networkCalls++; throw new Error("network forbidden"); } }), uploadDestination: "hidden", now: Date.now });
  try { await runtime.lifecycle.invalidateAttempt(ATTEMPT); assert.equal(networkCalls, 0); }
  finally { await runtime.lifecycle.close(); await env.close(); }
});
