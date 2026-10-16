import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerFlux3MediaReferenceService } from "../src/application/owner-flux3-media-reference-service.js";
import { createOwnerFlux3VideoOwnedRequestPreparer } from "../src/application/owner-flux3-video-owned-request-preparer.js";
import { OwnerFlux3VideoGenerationService, OwnerFlux3VideoGenerationServiceError } from "../src/application/owner-flux3-video-generation-service.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_flux3_generation_2018_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "flux3-generation-tenant", subject: "flux3-generation-owner" });
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, join(process.cwd(), "catalog")));
const CHAT = "flux3-generation-v2v-chat", ACK = "flux3-generation-v2v-ack";
const SOURCE = (() => { const bytes = new Uint8Array(28), view = new DataView(bytes.buffer); view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4); view.setUint32(12, 0); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24); return bytes; })();
const SOURCE_URL = "https://r2.syntx.ai/flux3-v2v/hidden/source.mp4";
const VIDEO_PROBE = { streams: [
  { codec_type: "video", codec_name: "synthetic-unlisted", width: 7680, height: 4320, duration: "240.5", disposition: { attached_pic: 0 } },
  { codec_type: "audio", codec_name: "synthetic-audio" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "240.8" } };
function response(value: unknown, status = 200): Response { return Response.json(value, { status }); }

test("Flux3 V2V preflights exact cost keys twice, never replays POST, and reconciles all observed videos after source TTL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-generation-2018-")), ffprobe = join(directory, "ffprobe");
  const script = `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(VIDEO_PROBE))});\n`;
  await writeFile(ffprobe, script, { mode: 0o700, flag: "wx" }); await chmod(ffprobe, 0o700);
  const trustedFfprobe = await realpath(ffprobe);
  const clock = { value: 1_000_000 }, now = () => clock.value;
  let balanceReads = 0, quoteReads = 0, chatCalls = 0, generationCalls = 0, historyCalls = 0, resultCalls = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-flux3-generation-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-flux3-linked-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  const attempt = await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attempt.attempt_id); await links.checkAttempt(BINDING, attempt.attempt_id);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, value => operation(value.value));
  } };
  const historyRows = [
    { id: ACK, chat_id: 77201, author_id: 17, message_object: [] },
    ...["one", "two"].map(suffix => ({ id: `flux3-generation-result-${suffix}`, chat_id: 77201, author_id: -1,
      message_object: [{ id: `flux3-generation-object-${suffix}`, message_id: `flux3-generation-result-${suffix}`,
        object_type: "video", object_url: `https://r2.syntx.ai/flux3-v2v/results/${suffix}.mp4`, completed: true, model_type: "flux3_v2v" }] }))
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return response({ balance: ["0.30", "0.29", "0.30", "0.30"][balanceReads++] ?? "0.30" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: false, type: null, end_date: null });
    if (url.pathname === "/api/v2/get_model_info") {
      quoteReads++;
      assert.equal(url.searchParams.get("ai_name"), "flux3_video"); assert.equal(url.searchParams.get("model_type"), "flux3_v2v");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "fhd"); assert.equal(url.searchParams.get("video_duration"), "15");
      return response({ access: true, cost: quoteReads === 1 ? null : 0.3, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("/chats/upload-files") && method === "POST") {
      const form = init.body as FormData; assert.equal(form.get("model_type"), "flux3_v2v");
      return response({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success", size: SOURCE.byteLength, content_type: "video/mp4" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCalls++; const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]); assert.equal(body.scope, "video");
      return response({ uuid: CHAT });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationCalls++; assert.equal(url.search, "?ai_name=flux3_video");
      const body = JSON.parse(String(init.body)) as Record<string, any>;
      assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
      assert.equal(body.chat_id, CHAT); assert.equal(body.prompt, "");
      assert.deepEqual(body.settings, { model_type: "flux3_v2v", video_duration: 15, resolution: "fhd", aspect_ratio: "auto",
        generate_audio: false, file_urls: [{ type: "video", url: SOURCE_URL }] });
      assert.equal(Object.hasOwn(body.settings, "n"), false); assert.equal(Object.hasOwn(body.settings, "draft"), false);
      return response({ id: ACK });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/messages` && method === "GET") {
      historyCalls++;
      if (historyCalls === 1) return response({ error: "synthetic temporary history failure" }, 503);
      return response({ messages: historyRows, pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    const match = new RegExp(`^/api/v1/chats/${CHAT}/(flux3-generation-result-(one|two))$`, "u").exec(url.pathname);
    if (match && method === "GET") {
      resultCalls++;
      const row = historyRows.find(value => value.id === match[1]); if (!row) throw new Error("unknown result message");
      return response(row);
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const referenceService = new OwnerFlux3MediaReferenceService({ ffprobePath: trustedFfprobe, destination: "hidden", binding: BINDING, linkService: links, resolveClient: () => client, now });
  const preparer = createOwnerFlux3VideoOwnedRequestPreparer({ referenceService, now });
  const service = new OwnerFlux3VideoGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    preparer, referenceService, resolveChatClient: () => client, now,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now) });
  try {
    const uploaded = await referenceService.uploadReference({ attemptId: ATTEMPT, model_id: "flux3_v2v", filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
    const request = { attemptId: ATTEMPT, request: { model_id: "flux3_v2v" as const, prompt: "", flux3_reference_handles: [uploaded.flux3_reference_handle],
      parameters: { resolution: "fhd" as const, video_duration: 15, generate_audio: false } } };
    await assert.rejects(service.generate(request), (error: unknown) => error instanceof OwnerFlux3VideoGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(chatCalls, 0); assert.equal(generationCalls, 0, "a missing price is not treated as free");
    await assert.rejects(service.generate(request), (error: unknown) => error instanceof OwnerFlux3VideoGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(chatCalls, 0); assert.equal(generationCalls, 0, "quote 0.30 must exceed balance 0.29");
    const outcome = await service.generate(request).then(() => null, error => error);
    assert.ok(outcome instanceof OwnerFlux3VideoGenerationServiceError); assert.equal(outcome.code, "OUTCOME_UNKNOWN");
    assert.match(outcome.recovery_id ?? "", /^flux3_video_recovery_[0-9a-f-]{36}$/u);
    assert.equal(quoteReads, 4); assert.equal(chatCalls, 1); assert.equal(generationCalls, 1);
    assert.equal((await service.listRecoveries({ attemptId: ATTEMPT })).length, 1);
    await assert.rejects(service.generate(request), (error: unknown) => error instanceof OwnerFlux3VideoGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(generationCalls, 1, "the same semantic intent is never POSTed twice");
    clock.value += 16 * 60_000;
    const completed = await service.reconcile({ attemptId: ATTEMPT, recovery_id: outcome.recovery_id! });
    assert.equal(completed.status, "completed"); assert.equal(completed.model_id, "flux3_v2v");
    assert.equal(completed.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY"); assert.equal(completed.output_count, "UNKNOWN");
    assert.equal(completed.backend_acceptance, "UNPROVEN"); assert.equal(completed.provider_terminal_status, "UNPROVEN");
    assert.equal(completed.cost_cap_enforced, false); assert.equal(completed.observed_artifact_count, 2);
    assert.deepEqual(completed.artifacts.map(item => item.object_url).sort(), ["https://r2.syntx.ai/flux3-v2v/results/one.mp4", "https://r2.syntx.ai/flux3-v2v/results/two.mp4"]);
    assert.equal(historyCalls, 2); assert.equal(resultCalls, 2); assert.equal(quoteReads, 4);
    const page = await service.getResultPage({ attemptId: ATTEMPT, recovery_id: outcome.recovery_id!, offset: 1 });
    assert.equal(page.artifacts.length, 1); assert.equal(page.next_offset, null);
  } finally { await service.close(); await referenceService.close(); await rm(directory, { recursive: true, force: true }); }
});

test("same Flux3 I2V intent keeps its first in-flight reservation after duplicate attempts are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-reservation-2024-")), ffprobe = join(directory, "ffprobe");
  const script = `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(VIDEO_PROBE))});\n`;
  await writeFile(ffprobe, script, { mode: 0o700, flag: "wx" }); await chmod(ffprobe, 0o700);
  const trustedFfprobe = await realpath(ffprobe), clock = { value: 1_000_000 }, now = () => clock.value;
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  let balanceReads = 0, quoteReads = 0, chatCalls = 0, generationCalls = 0, historyCalls = 0, resultCalls = 0;
  let signalBalanceStarted!: () => void, releaseBalance!: () => void;
  const balanceStarted = new Promise<void>(resolve => { signalBalanceStarted = resolve; });
  const heldBalance = new Promise<void>(resolve => { releaseBalance = resolve; });
  const chatIds: string[] = [], ackIds = new Map<string, string>();
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-flux3-reservation-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-flux3-reservation-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  const attempt = await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attempt.attempt_id); await links.checkAttempt(BINDING, attempt.attempt_id);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, value => operation(value.value));
  } };
  const resultRows = (chatUuid: string, ack: string) => [
    { id: ack, chat_id: 77201, author_id: 17, message_object: [] },
    { id: `${chatUuid}-result`, chat_id: 77201, author_id: -1, message_object: [{ id: `${chatUuid}-object`, message_id: `${chatUuid}-result`,
      object_type: "video", object_url: `https://r2.syntx.ai/flux3-i2v/results/${chatUuid}.mp4`, completed: true, model_type: "flux3_i2v" }] }
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") {
      balanceReads++;
      if (balanceReads === 1) { signalBalanceStarted(); await heldBalance; }
      return response({ balance: "10" });
    }
    if (url.pathname === "/api/v1/user/subscription") return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") {
      quoteReads++; assert.equal(url.searchParams.get("ai_name"), "flux3_video"); assert.equal(url.searchParams.get("model_type"), "flux3_i2v");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "hd"); assert.equal(url.searchParams.get("video_duration"), "5");
      return response({ access: true, cost: 0, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("/chats/upload-files") && method === "POST") {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(form.get("model_type"), "flux3_i2v"); assert.equal(file.name, "scene.png"); assert.equal(file.type, "image/png");
      return response({ files: [{ filename: "scene.png", url: "https://r2.syntx.ai/flux3-i2v/hidden/scene.png", status: "success",
        size: imageBytes.byteLength, content_type: "image/png" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCalls++; const chatUuid = `flux3-reservation-chat-${chatCalls}`; chatIds.push(chatUuid);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; assert.equal(body.scope, "video"); return response({ uuid: chatUuid });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationCalls++; const body = JSON.parse(String(init.body)) as Record<string, any>;
      const chatUuid = String(body.chat_id); assert.ok(chatIds.includes(chatUuid)); assert.equal(url.search, "?ai_name=flux3_video");
      assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]); assert.equal(body.prompt, "reservation prompt");
      assert.deepEqual(body.settings, { model_type: "flux3_i2v", video_duration: 5, resolution: "hd", aspect_ratio: "auto",
        generate_audio: true, file_urls: [{ type: "image", url: "https://r2.syntx.ai/flux3-i2v/hidden/scene.png" }] });
      const ack = `${chatUuid}-ack`; ackIds.set(chatUuid, ack); return response({ id: ack });
    }
    const chatMatch = /^\/api\/v1\/chats\/(flux3-reservation-chat-\d+)\/messages$/u.exec(url.pathname);
    if (chatMatch && method === "GET") {
      historyCalls++; const chatUuid = chatMatch[1]!, ack = ackIds.get(chatUuid); assert.ok(ack);
      const rows = resultRows(chatUuid, ack); return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: 2,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const messageMatch = /^\/api\/v1\/chats\/(flux3-reservation-chat-\d+)\/(flux3-reservation-chat-\d+-result)$/u.exec(url.pathname);
    if (messageMatch && method === "GET") {
      resultCalls++; const ack = ackIds.get(messageMatch[1]!); assert.ok(ack);
      return response(resultRows(messageMatch[1]!, ack)[1]);
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const referenceService = new OwnerFlux3MediaReferenceService({ ffprobePath: trustedFfprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => client, now });
  const preparer = createOwnerFlux3VideoOwnedRequestPreparer({ referenceService, now });
  const service = new OwnerFlux3VideoGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    preparer, referenceService, resolveChatClient: () => client, now,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now) });
  try {
    const uploaded = await referenceService.uploadReference({ attemptId: ATTEMPT, model_id: "flux3_i2v", filename: "scene.png", mime_type: "image/png", bytes: imageBytes });
    const request = { attemptId: ATTEMPT, request: { model_id: "flux3_i2v" as const, prompt: "reservation prompt",
      flux3_reference_handles: [uploaded.flux3_reference_handle], parameters: { resolution: "hd" as const, video_duration: 5, generate_audio: true } } };
    const firstOutcome = service.generate(request).then(value => ({ value }), error => ({ error }));
    await balanceStarted;
    await assert.rejects(service.generate(request), (error: unknown) => error instanceof OwnerFlux3VideoGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    const thirdOutcome = await service.generate(request).then(value => ({ value }), error => ({ error }));
    assert.deepEqual({ balanceReads, quoteReads, chatCalls, generationCalls }, { balanceReads: 1, quoteReads: 0, chatCalls: 0, generationCalls: 0 },
      "duplicate attempts cannot take over the first operation's in-flight reservation");
    assert.ok("error" in thirdOutcome && thirdOutcome.error instanceof OwnerFlux3VideoGenerationServiceError &&
      thirdOutcome.error.code === "INTENT_ALREADY_CLAIMED", "the third identical intent must still be rejected");
    releaseBalance();
    const firstOutcomeValue = await firstOutcome;
    if ("error" in firstOutcomeValue) throw firstOutcomeValue.error;
    const result = firstOutcomeValue.value;
    assert.equal(result.status, "completed"); assert.equal(result.model_id, "flux3_i2v");
    assert.equal(balanceReads, 2); assert.equal(quoteReads, 2); assert.equal(chatCalls, 1); assert.equal(generationCalls, 1);
    assert.equal(historyCalls, 1); assert.equal(resultCalls, 1);
  } finally { releaseBalance(); await service.close(); await referenceService.close(); await rm(directory, { recursive: true, force: true }); }
});
