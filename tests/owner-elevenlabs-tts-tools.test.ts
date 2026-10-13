import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerElevenLabsTtsGenerationService } from "../src/application/owner-elevenlabs-tts-generation-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, OWNER_ELEVENLABS_TTS_MODEL_IDS } from "../src/application/owner-elevenlabs-generation-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const MODULE_URL = new URL("../src/mcp/owner-elevenlabs-tts-tools.js", import.meta.url).href;
const ATTEMPT = "link_elevenlabs_tts_tools_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "elevenlabs-tts-tools-tenant", subject: "elevenlabs-tts-tools-owner" });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION));
const PRIVATE_VOICE_ID = "synthetic_private_voice_id";
const PROMPT = "Speech 🎙️";
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

async function loadTools(): Promise<Record<string, unknown>> {
  try { return await import(MODULE_URL) as Record<string, unknown>; }
  catch (error) { assert.fail(`MISSING_OWNER_ELEVENLABS_TTS_TOOLS_MODULE: ${String(error)}`); }
}

async function fixture(options: { readonly outputCount?: number; readonly loseAck?: boolean } = {}) {
  let now = Date.parse("2026-10-13T02:00:00.000Z");
  let chats = 0;
  let posts = 0;
  let historyGets = 0;
  let resultGets = 0;
  let voiceGets = 0;
  const events: Array<{ readonly method: string; readonly path: string; readonly body?: unknown }> = [];
  const jobs = new Map<string, { readonly prompt: string; readonly model: string; readonly ack: string;
    readonly rows: readonly { readonly messageId: string; readonly objects: readonly { readonly id: string; readonly url: string }[] }[] }>();
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-elevenlabs-tools-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-elevenlabs-tools-credential" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, path: url.pathname, ...(body === undefined ? {} : { body }) });
    if (url.pathname === "/api/v1/user/balance" && method === "GET") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") return Response.json({ active: true,
      type: "PRO", end_date: "2026-10-14T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") return Response.json({ access: true, cost: 1,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/audio/elevenlabs/voice_examples" && method === "GET") {
      voiceGets += 1;
      return Response.json([{ voice_id: PRIVATE_VOICE_ID, name: "Private synthetic voice" }]);
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chats += 1; return Response.json({ uuid: `elevenlabs-tools-chat-${chats}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      posts += 1;
      const request = body as { readonly chat_uuid: string; readonly prompt: string; readonly settings: { readonly model_type: string } };
      const ack = `elevenlabs-tools-ack-${posts}`;
      const count = options.outputCount ?? 1;
      const rows = Array.from({ length: Math.ceil(count / 64) }, (_, rowIndex) => {
        const start = rowIndex * 64, length = Math.min(64, count - start);
        const messageId = `elevenlabs-tools-bot-${posts}-${rowIndex + 1}`;
        return Object.freeze({ messageId, objects: Object.freeze(Array.from({ length }, (_, index) => {
          const n = start + index + 1;
          return Object.freeze({ id: `elevenlabs-tools-object-${posts}-${n}`,
            url: `https://r2.syntx.ai/generated/tts-tools-${posts}-${n}.mp3` });
        })) });
      });
      jobs.set(request.chat_uuid, Object.freeze({ prompt: request.prompt, model: request.settings.model_type, ack, rows: Object.freeze(rows) }));
      if (options.loseAck) throw new Error("Synthetic connection lost after the only POST.");
      return Response.json({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      historyGets += 1;
      const job = jobs.get(history[1]!); assert.ok(job, "history must be read through the private fresh chat context");
      const messages: Array<Record<string, unknown>> = [{ id: job.ack, chat_id: 9001, author_id: 41,
        message_object: [{ id: `ack-object-${job.ack}`, message_id: job.ack, object_type: "text", object_text: job.prompt, model_type: job.model }] }];
      for (const row of job.rows) messages.push({ id: row.messageId, chat_id: 9001, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "audio", model_type: job.model })) });
      const page = Number(url.searchParams.get("page")), size = 10, pages = Math.ceil(messages.length / size);
      return Response.json({ messages: messages.slice((page - 1) * size, page * size), pagination: {
        page, page_size: size, total_count: messages.length, total_pages: pages,
        has_next: page < pages, has_previous: page > 1
      } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      resultGets += 1;
      const job = jobs.get(result[1]!); assert.ok(job);
      const row = job.rows.find((item) => item.messageId === result[2]); assert.ok(row);
      return Response.json({ id: row.messageId, chat_id: 9001, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId,
          object_type: "audio", object_url: object.url, completed: true, model_type: job.model })) });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const voiceHttpClient = new SyntxHttpClient({ credentialBroker: broker, fetchImpl });
  const voiceReferenceService = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService,
    resolveClient: () => voiceHttpClient, now: () => now });
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl, maxResponseBytes: 2 * 1024 * 1024 });
  const service = new OwnerElevenLabsTtsGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, resolveChatClient: () => chatClient, voiceReferenceService,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now),
    now: () => now });
  return { service, voiceReferenceService, linkService, events, get counts() { return { chats, posts, historyGets, resultGets, voiceGets }; }, close: async () => {
    await service.close(); await voiceReferenceService.close();
  } };
}

function ttsRequest(model: typeof OWNER_ELEVENLABS_TTS_MODEL_IDS[number], voiceRef: string) {
  return { model_id: model, mode: "text_to_speech", prompt: PROMPT, voice_ref: voiceRef,
    stability: 0.5, similarity_boost: model === "eleven_v4" || model === "eleven_v4_turbo" ? 0.75 : 0.5,
    ...(model === "eleven_v4" || model === "eleven_v4_turbo" ? { language_code: "auto" } : {}) };
}

async function connectTools(toolsModule: Record<string, unknown>, f: Awaited<ReturnType<typeof fixture>>) {
  const server = new McpServer({ name: "elevenlabs-tts-tools-test", version: "1.0.0" });
  const register = toolsModule.registerSyntxOwnerElevenLabsTtsTools as (server: McpServer, options: unknown) => void;
  register(server, { generationService: f.service, voiceReferenceService: f.voiceReferenceService });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "elevenlabs-tts-tools-stock-sdk-test", version: "1.0.0" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { server, client, close: async () => { await Promise.all([client.close(), server.close()]); } };
}

test("owner TTS tool composition requires nominal generation service and real voice service", async () => {
  const module = await loadTools(), f = await fixture();
  try {
    const server = new McpServer({ name: "elevenlabs-tts-composition-test", version: "1.0.0" });
    const register = module.registerSyntxOwnerElevenLabsTtsTools as (server: McpServer, options: unknown) => void;
    assert.throws(() => register(server, { generationService: {
      async generate() { return {}; }, async reconcile() { return {}; }, async listRecoveries() { return []; }, async getResultPage() { return {}; }
    }, voiceReferenceService: f.voiceReferenceService }), /ELEVENLABS_TTS_SERVICE_COMPOSITION_INVALID/u);
    assert.throws(() => register(server, { generationService: f.service, voiceReferenceService: {
      async listVoices() { return { voices: [] }; }
    } }), /ELEVENLABS_TTS_SERVICE_COMPOSITION_INVALID/u);
    await server.close();
  } finally { await f.close(); }
});
test("Stock SDK lists six tools, safe source parameters and owner names with opaque voice refs", async () => {
  const module = await loadTools(), f = await fixture(), pair = await connectTools(module, f);
  try {
    const listed = (await pair.client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(listed, module.OWNER_ELEVENLABS_TTS_TOOL_NAMES);
    const generate = (await pair.client.listTools()).tools.find(({ name }) => name === "syntx_owner_generate_elevenlabs_tts");
    assert.ok(generate); assert.ok(Array.isArray((generate.inputSchema as { oneOf?: unknown }).oneOf));
    const parameters = await pair.client.callTool({ name: "syntx_get_elevenlabs_tts_parameters", arguments: {} });
    assert.equal(parameters.isError, undefined, JSON.stringify(parameters));
    assert.equal((parameters.structuredContent as { runtime_usable: unknown }).runtime_usable, false);
    assert.equal((parameters.structuredContent as { backend_acceptance: unknown }).backend_acceptance, "UNPROVEN");
    assert.equal(f.counts.voiceGets, 0, "static parameter inspection performs no network request");
    const voices = await pair.client.callTool({ name: "syntx_owner_list_elevenlabs_voice_references", arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(voices.isError, undefined, JSON.stringify(voices));
    const serialized = JSON.stringify(voices.structuredContent);
    assert.equal(serialized.includes(PRIVATE_VOICE_ID), false);
    assert.equal(serialized.includes("https://"), false);
    const voice = (voices.structuredContent as { voices: Array<{ voice_ref: string; name: string }> }).voices[0]!;
    assert.equal(voice.name, "Private synthetic voice", "owner-bound display names make opaque references selectable");
    assert.match(voice.voice_ref, /^owner_elevenlabs_voice_/u);
    assert.equal(f.counts.voiceGets, 1);
  } finally { await pair.close(); await f.close(); }
});

test("Stock SDK runs genuine TTS and returns all 80 observed audios as 64+16 local pages without page I/O", async () => {
  const module = await loadTools(), f = await fixture({ outputCount: 80 }), pair = await connectTools(module, f);
  try {
    const voiceResponse = await pair.client.callTool({ name: "syntx_owner_list_elevenlabs_voice_references", arguments: { link_attempt_id: ATTEMPT } });
    const voiceRef = (voiceResponse.structuredContent as { voices: Array<{ voice_ref: string }> }).voices[0]!.voice_ref;
    const invalid = await pair.client.callTool({ name: "syntx_owner_generate_elevenlabs_tts", arguments: {
      link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v3", voiceRef), stability: 0.55
    } });
    assert.equal(invalid.isError, true);
    assert.equal(f.counts.posts, 0, "rejected non-V4 slider values do not reach the generation service/native POST");
    const args = { link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v4_turbo", voiceRef) };
    const first = await pair.client.callTool({ name: "syntx_owner_generate_elevenlabs_tts", arguments: args });
    assert.equal(first.isError, undefined, JSON.stringify(first));
    const result = first.structuredContent as { status: string; status_semantics: string; backend_acceptance: string;
      provider_terminal_status: string; recovery_id: string; artifacts: Array<{ message_object_id: string }>; next_offset: number | null };
    assert.equal(result.status, "completed");
    assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.artifacts.length, 64); assert.equal(result.next_offset, 64);
    const before = f.counts;
    const second = await pair.client.callTool({ name: "syntx_owner_get_elevenlabs_tts_result_page",
      arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id, offset: 64 } });
    assert.equal(second.isError, undefined, JSON.stringify(second));
    const page = second.structuredContent as { offset: number; artifacts: Array<{ message_object_id: string }>; next_offset: number | null };
    assert.equal(page.offset, 64); assert.equal(page.artifacts.length, 16); assert.equal(page.next_offset, null);
    assert.deepEqual(f.counts, before, "cache-only result-page reads cannot issue another upstream request");
    assert.equal(new Set([...result.artifacts, ...page.artifacts].map(({ message_object_id }) => message_object_id)).size, 80);
    assert.equal(f.counts.posts, 1);
    const post = f.events.find(({ path, method }) => path === "/api/v1/audio/generate" && method === "POST");
    assert.ok(post);
    const body = post.body as { settings: { model_type: string; voice_id: string }; prompt: string };
    assert.equal(body.settings.model_type, "eleven_v4_turbo"); assert.equal(body.prompt, PROMPT);
    assert.equal(body.settings.voice_id, PRIVATE_VOICE_ID, "provider voice IDs remain only on the native wire");
    assert.equal(JSON.stringify(first.structuredContent).includes(PRIVATE_VOICE_ID), false);
  } finally { await pair.close(); await f.close(); }
});

test("uncertain TTS generation exposes only recovery guidance and reconcile is GET-only", async () => {
  const module = await loadTools(), f = await fixture({ loseAck: true }), pair = await connectTools(module, f);
  try {
    const voiceResponse = await pair.client.callTool({ name: "syntx_owner_list_elevenlabs_voice_references", arguments: { link_attempt_id: ATTEMPT } });
    const voiceRef = (voiceResponse.structuredContent as { voices: Array<{ voice_ref: string }> }).voices[0]!.voice_ref;
    const outcome = await pair.client.callTool({ name: "syntx_owner_generate_elevenlabs_tts", arguments: {
      link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v4_turbo", voiceRef)
    } });
    assert.equal(outcome.isError, true);
    const errorContent = (outcome as { content: Array<{ type: string; text?: string }> }).content;
    const errorText = errorContent.find((item) => item.type === "text")?.text ?? "";
    const parsed = JSON.parse(errorText) as { error: { code: string; recovery_id: string } };
    assert.equal(parsed.error.code, "OUTCOME_UNKNOWN"); assert.match(parsed.error.recovery_id, /^elevenlabs_tts_recovery_/u);
    assert.equal(errorText.includes("credential"), false); assert.equal(errorText.includes(PRIVATE_VOICE_ID), false);
    const before = f.counts;
    const recoveryList = await pair.client.callTool({ name: "syntx_owner_list_elevenlabs_tts_recoveries", arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(recoveryList.isError, undefined);
    const reconciled = await pair.client.callTool({ name: "syntx_owner_reconcile_elevenlabs_tts", arguments: {
      link_attempt_id: ATTEMPT, recovery_id: parsed.error.recovery_id
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    assert.equal(f.counts.posts, before.posts, "neither list nor reconcile can replay POST");
    assert.equal(f.counts.chats, before.chats);
    assert.equal(f.counts.historyGets, before.historyGets + 1);
    assert.equal(f.counts.resultGets, before.resultGets + 1);
  } finally { await pair.close(); await f.close(); }
});

test("TTS MCP exposes exactly the six TTS-only tool names and strict complete-input schemas", async () => {
  const module = await loadTools();
  assert.deepEqual(module.OWNER_ELEVENLABS_TTS_TOOL_NAMES, [
    "syntx_get_elevenlabs_tts_parameters", "syntx_owner_list_elevenlabs_voice_references",
    "syntx_owner_generate_elevenlabs_tts", "syntx_owner_reconcile_elevenlabs_tts",
    "syntx_owner_list_elevenlabs_tts_recoveries", "syntx_owner_get_elevenlabs_tts_result_page"
  ]);
  const schemas = module.OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS as { generate: { safeParse(value: unknown): { success: boolean } } };
  const voiceRef = "owner_elevenlabs_voice_00000000-0000-4000-8000-000000000001";
  for (const model of OWNER_ELEVENLABS_TTS_MODEL_IDS) {
    assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest(model, voiceRef) }).success, true, model);
  }
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v3", voiceRef), mode: "text_to_dialogue" }).success, false);
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v4", voiceRef), stability: undefined }).success, false);
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v3", voiceRef), stability: 0.55 }).success, false,
    "non-V4 accepted fixed local preparer values, not a claimed source slider range");
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v4", voiceRef), stability: 0.55 }).success, true);
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v3", voiceRef), language_code: "auto" }).success, false);
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_multilingual_v2", voiceRef), prompt: "😀".repeat(2501) }).success, false);
});

test("TTS V4 MCP schema admits exactly every source 0.05 control step without binary-float holes", async () => {
  const module = await loadTools();
  const schemas = module.OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS as { generate: { safeParse(value: unknown): { success: boolean } } };
  const voiceRef = "owner_elevenlabs_voice_00000000-0000-4000-8000-000000000001";
  let accepted = 0;
  for (const model of ["eleven_v4", "eleven_v4_turbo"] as const) {
    for (let stabilityIndex = 0; stabilityIndex <= 20; stabilityIndex += 1) {
      for (let similarityIndex = 0; similarityIndex <= 20; similarityIndex += 1) {
        const input = { link_attempt_id: ATTEMPT, ...ttsRequest(model, voiceRef),
          stability: stabilityIndex / 20, similarity_boost: similarityIndex / 20 };
        assert.equal(schemas.generate.safeParse(input).success, true, `${model}:${stabilityIndex}:${similarityIndex}`);
        accepted += 1;
      }
    }
  }
  assert.equal(accepted, 882);
  assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, ...ttsRequest("eleven_v4", voiceRef), stability: 0.151 }).success, false);
});
