import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerElevenLabsStsGenerationService, OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION } from "../src/application/owner-elevenlabs-sts-generation-service.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import { createOwnerElevenLabsStsRequestPreparer } from "../src/application/owner-elevenlabs-sts-request-preparer.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_ELEVENLABS_STS_TOOL_NAMES, SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME,
  SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME, SYNTX_OWNER_LIST_ELEVENLABS_STS_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_ELEVENLABS_STS_RESULT_PAGE_TOOL_NAME } from "../src/mcp/owner-elevenlabs-sts-tools.js";

const ATTEMPT = "link_sts_sdk_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-sdk-tenant", subject: "sts-sdk-owner" });
const INPUT_URL = "https://r2.syntx.ai/private/sts-sdk-input.mp3";
const OUTPUT_URL = "https://r2.syntx.ai/private/sts-sdk-output.mp3";
const INPUT_MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION, `${process.cwd()}/catalog`));
const stores = new Set<InMemoryAuthLinkStore>();

test("stock SDK composes exact STS tools with genuine owner services and validates uploaded/generation outputs", async () => {
  let now = Date.parse("2026-10-15T00:00:00.000Z"), chats = 0, generations = 0, histories = 0, results = 0, uploads = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-sdk", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now); stores.add(store);
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(run: (credential: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (credential) => run(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (url.pathname.endsWith("/chats/upload-files") && method === "POST") { uploads++; return Response.json({ files: [{ filename: "input.mp3", url: INPUT_URL,
      status: "success", size: INPUT_MP3.byteLength, content_type: "audio/mpeg", duration: 11.006259 }] }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chats++; return Response.json({ uuid: `sts-sdk-chat-${chats}` }); }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      generations++; const body = JSON.parse(String(init?.body)) as { prompt: string; settings: Record<string, unknown> };
      assert.equal(body.prompt, ""); assert.deepEqual(Object.keys(body.settings).sort(), ["duration", "file_urls", "mode", "model_type", "voice_id"]);
      assert.equal(body.settings.model_type, "eleven_multilingual_sts_v2"); assert.equal(body.settings.mode, "speech_to_speech"); assert.equal(body.settings.duration, 11);
      return Response.json({ id: "sts-sdk-owner-ack" });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      histories++; return Response.json({ messages: [
        { id: "sts-sdk-owner-ack", chat_id: 42, author_id: 17,
          message_object: [{ id: "sts-sdk-ack-object", message_id: "sts-sdk-owner-ack", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] },
        { id: "sts-sdk-bot-result", chat_id: 42, author_id: -1,
          message_object: [{ id: "sts-sdk-bot-object", message_id: "sts-sdk-bot-result", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/sts-sdk-bot-result") && method === "GET") {
      results++; return Response.json({ id: "sts-sdk-bot-result", chat_id: 42, author_id: -1, message_object: [
        { id: "sts-sdk-bot-object", object_type: "audio", object_url: OUTPUT_URL, completed: true, model_type: "eleven_multilingual_sts_v2" }
      ] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  } });
  const voiceClient = new SyntxHttpClient({ credentialBroker, fetchImpl: async () => Response.json([{ voice_id: "private-sts-voice", name: "Studio" }]) });
  const voices = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService: links, resolveClient: () => voiceClient, now: () => now });
  const directory = await mkdtemp(join(tmpdir(), "syntx-sts-mcp-1457-"));
  const ffprobe = join(directory, "ffprobe");
  const probeOutput = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2, nb_read_frames: "500", duration: "11.006259" }], format: { format_name: "mp3", duration: "11.006259" } });
  await writeFile(ffprobe, `#!/bin/sh\nprintf '%s' '${probeOutput}'\n`); await chmod(ffprobe, 0o700);
  const originals = new OwnerElevenLabsStsOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => chatClient, now: () => now });
  const preparer = createOwnerElevenLabsStsRequestPreparer({ originalReferenceService: originals, voiceReferenceService: voices, now: () => now });
  const accountFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2026-10-16T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    throw new Error(`unexpected account request ${url.pathname}`);
  };
  const createReadClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl: accountFetch });
  const service = new OwnerElevenLabsStsGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION, preparer, resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(createReadClient(), () => now),
    createModelAccessService: () => new ModelAccessService(CATALOG, createReadClient(), () => now), now: () => now });
  const server = createMcpServer(createDefaultApplication(), { ownerElevenLabsSts: { originalReferenceService: originals,
    voiceReferenceService: voices, generationService: service } });
  const client = new Client({ name: "elevenlabs-sts-real-sdk-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_ELEVENLABS_STS_TOOL_NAMES as readonly string[]).includes(name)), OWNER_ELEVENLABS_STS_TOOL_NAMES);
    assert.equal(names.filter((name) => name === "syntx_owner_list_elevenlabs_voice_references").length, 1);
    const parameters = await client.callTool({ name: "syntx_get_elevenlabs_sts_parameters", arguments: {} });
    assert.equal(parameters.isError, undefined);
    assert.equal((parameters.structuredContent as { status: string }).status, "PARTIAL_SOURCE_REPORT");
    const voiceResult = await client.callTool({ name: "syntx_owner_list_elevenlabs_voice_references", arguments: { link_attempt_id: ATTEMPT } });
    const voiceRef = (voiceResult.structuredContent as { voices: Array<{ voice_ref: string }> }).voices[0]!.voice_ref;
    const badUpload = await client.callTool({ name: SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, filename: "input.mp3", mime_type: "audio/mpeg", content_base64: Buffer.from(INPUT_MP3).toString("base64"), destination: "uploaded"
    } });
    assert.equal(badUpload.isError, true); assert.equal(uploads, 0, "extra field must be rejected before native upload");
    const badBase64 = await client.callTool({ name: SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, filename: "input.mp3", mime_type: "audio/mpeg", content_base64: "AB=="
    } });
    assert.equal(badBase64.isError, true); assert.equal(uploads, 0, "noncanonical base64 must be rejected before native upload");
    const uploaded = await client.callTool({ name: SYNTX_OWNER_UPLOAD_ELEVENLABS_STS_ORIGINAL_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, filename: "input.mp3", mime_type: "audio/mpeg", content_base64: Buffer.from(INPUT_MP3).toString("base64")
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    const original = uploaded.structuredContent as { audio_original_handle: string; sha256: string; size: number; mime_type: string };
    assert.match(original.audio_original_handle, /^elevenlabs_sts_original_/u); assert.match(original.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(original.sha256, createHash("sha256").update(INPUT_MP3).digest("hex"));
    assert.equal(original.size, INPUT_MP3.length); assert.equal(original.mime_type, "audio/mpeg");
    const foreign = await client.callTool({ name: SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "eleven_multilingual_sts_v2", mode: "speech_to_speech", audio_original_handle: original.audio_original_handle,
      voice_ref: voiceRef, prompt: "not accepted"
    } });
    assert.equal(foreign.isError, true); assert.equal(generations, 0);
    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "eleven_multilingual_sts_v2", mode: "speech_to_speech", audio_original_handle: original.audio_original_handle, voice_ref: voiceRef
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const result = generated.structuredContent as { status: string; backend_acceptance: string; recovery_id: string;
      artifacts: Array<{ object_url: string; message_object_id: string }>; diagnostic: { post_started: boolean } };
    assert.equal(result.status, "completed"); assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.diagnostic.post_started, true);
    assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL); assert.equal(result.artifacts[0]?.message_object_id, "sts-sdk-bot-object");
    assert.equal(JSON.stringify(generated.structuredContent).includes("private-sts-voice"), false);
    const replay = await client.callTool({ name: SYNTX_OWNER_GENERATE_ELEVENLABS_STS_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "eleven_multilingual_sts_v2", mode: "speech_to_speech",
      audio_original_handle: "elevenlabs_sts_original_00000000-0000-4000-8000-000000000000", voice_ref: voiceRef
    } });
    assert.equal(replay.isError, true); assert.equal(generations, 1, "foreign or repeated intent cannot dispatch a second generation");
    const recoveries = await client.callTool({ name: SYNTX_OWNER_LIST_ELEVENLABS_STS_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(recoveries.isError, undefined); assert.equal((recoveries.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
    const reconciled = await client.callTool({ name: "syntx_owner_reconcile_elevenlabs_sts", arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id } });
    assert.equal(reconciled.isError, undefined); assert.equal((reconciled.structuredContent as { recovery_id: string }).recovery_id, result.recovery_id);
    const page = await client.callTool({ name: SYNTX_OWNER_GET_ELEVENLABS_STS_RESULT_PAGE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id } });
    assert.equal(page.isError, undefined); assert.equal((page.structuredContent as { artifacts: unknown[] }).artifacts.length, 1);
    assert.equal(generations, 1); assert.equal(chats, 1); assert.equal(histories, 1); assert.equal(results, 1); assert.equal(uploads, 1);
  } finally {
    await Promise.allSettled([client.close(), server.close(), service.close(), originals.close(), voices.close()]);
    store.close(); stores.delete(store); await rm(directory, { recursive: true, force: true });
  }
});
