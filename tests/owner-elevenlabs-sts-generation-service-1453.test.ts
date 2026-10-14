import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import { OwnerElevenLabsStsGenerationService, OwnerElevenLabsStsGenerationServiceError } from "../src/application/owner-elevenlabs-sts-generation-service.js";
import { createOwnerElevenLabsStsRequestPreparer } from "../src/application/owner-elevenlabs-sts-request-preparer.js";
import { OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION } from "../src/application/owner-elevenlabs-sts-generation-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";

const ATTEMPT = "link_sts_service_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-service-tenant", subject: "sts-service-owner" });
const INPUT_URL = "https://r2.syntx.ai/private/sts-service-input.mp3";
const OUTPUT_URL = "https://r2.syntx.ai/private/sts-service-output.mp3";
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION));
function json(value: unknown): Response { return Response.json(value); }

async function fixture(options: { readonly denyAccessAt?: number; readonly failFirstHistory?: boolean; readonly losePostAck?: boolean } = {}) {
  let now = Date.parse("2026-10-15T00:00:00.000Z"), chatCount = 0, generationCount = 0, historyCount = 0, resultCount = 0, accessCount = 0;
  const queries: Array<Readonly<Record<string, string>>> = [];
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-service", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now);
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(run: (credential: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (credential) => run(credential.value));
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (url.pathname.endsWith("/chats/upload-files")) return json({ files: [{ filename: "input.mp3", url: INPUT_URL,
      status: "success", size: MP3.byteLength, content_type: "audio/mpeg", duration: 11.006259 }] });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCount++; return json({ uuid: `sts-service-chat-${chatCount}` }); }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      generationCount++; const body = JSON.parse(String(init?.body)) as { chat_uuid: string; prompt: string; settings: Record<string, unknown> };
      assert.equal(body.prompt, ""); assert.equal(body.settings.duration, 11); assert.equal(body.settings.mode, "speech_to_speech");
      assert.equal(body.settings.model_type, "eleven_multilingual_sts_v2");
      assert.deepEqual(Object.keys(body.settings).sort(), ["duration", "file_urls", "mode", "model_type", "voice_id"]);
      if (options.losePostAck) throw new Error("synthetic connection loss after generation dispatch");
      return json({ id: "sts-service-owner-ack" });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      historyCount++;
      if (options.failFirstHistory && historyCount === 1) throw new Error("synthetic transient GET failure");
      const messages = [
        { id: "sts-service-owner-ack", chat_id: 42, author_id: 17,
          message_object: [{ id: "sts-service-ack-object", message_id: "sts-service-owner-ack", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] },
        { id: "sts-service-bot-result", chat_id: 42, author_id: -1,
          message_object: [{ id: "sts-service-bot-object", message_id: "sts-service-bot-result", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] }
      ];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/sts-service-bot-result") && method === "GET") {
      resultCount++; return json({ id: "sts-service-bot-result", chat_id: 42, author_id: -1,
        message_object: [{ id: "sts-service-bot-object", object_type: "audio", object_url: OUTPUT_URL, completed: true,
          model_type: "eleven_multilingual_sts_v2" }] });
    }
    throw new Error(`unexpected synthetic owner client request: ${method} ${url.pathname}`);
  } });
  const voiceClient = new SyntxHttpClient({ credentialBroker, fetchImpl: async () => json([{ voice_id: "voice_sts_001", name: "Studio" }]) });
  const voices = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService: links, resolveClient: () => voiceClient, now: () => now });
  const voicesPage = await voices.listVoices({ attemptId: ATTEMPT });
  const voiceRef = (voicesPage.voices[0] as { voice_ref: string }).voice_ref;
  const directory = await mkdtemp(join(tmpdir(), "syntx-sts-service-1453-"));
  const ffprobe = join(directory, "ffprobe");
  const probeOutput = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2,
    nb_read_frames: "500", duration: "11.006259" }], format: { format_name: "mp3", duration: "11.006259" } });
  await writeFile(ffprobe, `#!/bin/sh\nprintf '%s' '${probeOutput}'\n`); await chmod(ffprobe, 0o700);
  const originals = new OwnerElevenLabsStsOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => client, now: () => now });
  const original = await originals.uploadOriginal({ attemptId: ATTEMPT, filename: "input.mp3", mime_type: "audio/mpeg", bytes: MP3 });
  const preparer = createOwnerElevenLabsStsRequestPreparer({ originalReferenceService: originals, voiceReferenceService: voices, now: () => now });
  const accountFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/user/balance") return json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return json({ active: true, type: "PRO", end_date: "2026-10-16T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") {
      accessCount++; queries.push(Object.freeze(Object.fromEntries(url.searchParams.entries())));
      return json({ access: accessCount !== options.denyAccessAt, cost: 1, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    throw new Error(`unexpected preflight request: ${url.pathname}`);
  };
  const createAccountStatusService = () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl: accountFetch }), () => now);
  const createModelAccessService = () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker, fetchImpl: accountFetch }), () => now);
  const service = new OwnerElevenLabsStsGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION, preparer, resolveChatClient: () => client,
    createAccountStatusService, createModelAccessService, now: () => now });
  return { service, preparer, originals, voices, links, store, original, voiceRef, queries,
    counts: () => ({ chatCount, generationCount, historyCount, resultCount, accessCount }),
    advance(ms: number) { now += ms; },
    request: { model_id: "eleven_multilingual_sts_v2", mode: "speech_to_speech", audio_original_handle: original.audio_original_handle, voice_ref: voiceRef },
    cleanup: async () => { await service.close(); await originals.close(); await voices.close(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("service composes actual STS prep, double fresh preflight, one native generation and owned MP3 result", async () => {
  const f = await fixture();
  try {
    const result = await f.service.generate({ attemptId: ATTEMPT, request: f.request });
    assert.equal(result.status, "completed"); assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.cost_cap_enforced, false); assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL);
    assert.equal(result.artifacts[0]?.model_id, "eleven_multilingual_sts_v2");
    assert.equal(f.counts().chatCount, 1); assert.equal(f.counts().generationCount, 1);
    assert.equal(f.counts().accessCount, 2); assert.equal(f.counts().historyCount, 1); assert.equal(f.counts().resultCount, 1);
    assert.deepEqual(f.queries.map(({ mode, duration, model_type }) => ({ mode, duration, model_type })), [
      { mode: "speech_to_speech", duration: "11", model_type: "eleven_multilingual_sts_v2" },
      { mode: "speech_to_speech", duration: "11", model_type: "eleven_multilingual_sts_v2" }
    ]);
    await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, request: f.request }),
      (e: unknown) => e instanceof OwnerElevenLabsStsGenerationServiceError && e.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts().generationCount, 1);
    const page = await f.service.getResultPage({ attemptId: ATTEMPT, recovery_id: result.recovery_id });
    assert.deepEqual(page.artifacts, result.artifacts);
  } finally { await f.cleanup(); }
});

test("access denial on either fresh preflight prevents its following chat or generation POST", async (t) => {
  for (const denyAccessAt of [1, 2]) {
    await t.test(`deny access check ${denyAccessAt}`, async () => {
      const f = await fixture({ denyAccessAt });
      try {
        await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, request: f.request }),
          (e: unknown) => e instanceof OwnerElevenLabsStsGenerationServiceError && e.code === "PREFLIGHT_FAILED");
        assert.equal(f.counts().generationCount, 0);
        assert.equal(f.counts().chatCount, denyAccessAt === 1 ? 0 : 1);
      } finally { await f.cleanup(); }
    });
  }
});

test("unknown history outcome keeps a semantic tombstone and supports exact-client GET-only recovery after input TTL", async () => {
  const f = await fixture({ failFirstHistory: true });
  try {
    let recoveryId = "";
    await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, request: f.request }), (e: unknown) => {
      if (!(e instanceof OwnerElevenLabsStsGenerationServiceError) || e.code !== "OUTCOME_UNKNOWN" || !e.recovery_id) return false;
      recoveryId = e.recovery_id; return true;
    });
    assert.equal(f.counts().generationCount, 1);
    await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, request: f.request }),
      (e: unknown) => e instanceof OwnerElevenLabsStsGenerationServiceError && e.code === "INTENT_ALREADY_CLAIMED");
    f.advance(15 * 60_000 + 1);
    const renewedOriginal = await f.originals.uploadOriginal({ attemptId: ATTEMPT, filename: "input.mp3",
      mime_type: "audio/mpeg", bytes: MP3 });
    assert.equal(renewedOriginal.sha256, f.original.sha256);
    const renewedVoicePage = await f.voices.listVoices({ attemptId: ATTEMPT });
    const renewedVoiceRef = (renewedVoicePage.voices[0] as { voice_ref: string }).voice_ref;
    assert.notEqual(renewedVoiceRef, f.voiceRef);
    await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, request: { ...f.request,
      audio_original_handle: renewedOriginal.audio_original_handle, voice_ref: renewedVoiceRef } }),
      (e: unknown) => e instanceof OwnerElevenLabsStsGenerationServiceError && e.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts().chatCount, 1);
    assert.equal(f.counts().generationCount, 1);
    const recovered = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(recovered.status, "completed"); assert.equal(recovered.artifacts[0]?.object_url, OUTPUT_URL);
    assert.equal(f.counts().generationCount, 1); assert.equal(f.counts().historyCount, 2); assert.equal(f.counts().resultCount, 1);
    await f.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (e: unknown) => e instanceof OwnerElevenLabsStsGenerationServiceError && e.code === "RECOVERY_NOT_FOUND");
  } finally { await f.cleanup(); }
});

test("unknown native POST acknowledgement never fabricates an owner-result binding", async () => {
  const f = await fixture({ losePostAck: true });
  try {
    let recoveryId = "";
    await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, request: f.request }), (e: unknown) => {
      if (!(e instanceof OwnerElevenLabsStsGenerationServiceError) || e.code !== "OUTCOME_UNKNOWN" || !e.recovery_id) return false;
      recoveryId = e.recovery_id; return true;
    });
    assert.equal(f.counts().generationCount, 1);
    await assert.rejects(() => f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (e: unknown) => e instanceof OwnerElevenLabsStsGenerationServiceError && e.code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts().resultCount, 0);
    assert.equal(f.counts().generationCount, 1);
  } finally { await f.cleanup(); }
});
