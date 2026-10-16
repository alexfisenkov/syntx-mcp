import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerTopazEnhanceOriginalReferenceService } from "../src/application/owner-topaz-enhance-original-reference-service.js";
import { createOwnerTopazEnhanceOwnedRequestPreparer } from "../src/application/owner-topaz-enhance-owned-request-preparer.js";
import { OwnerTopazEnhanceGenerationService, OwnerTopazEnhanceGenerationServiceError } from "../src/application/owner-topaz-enhance-generation-service.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_topaz_enhance_service_1986_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "topaz-enhance-generation-tenant", subject: "generation-owner" });
const SOURCE = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x31, 0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);
const SOURCE_URL = "https://r2.syntx.ai/topaz-enhance/private/source.mp4", RESULT_URL = "https://r2.syntx.ai/topaz-enhance/private/result.mp4";
const CHAT = "topaz-enhance-service-chat", ACK = "topaz-enhance-service-ack", MESSAGE = "topaz-enhance-result-message", OBJECT = "topaz-enhance-result-object";
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, join(process.cwd(), "catalog")));
function response(value: unknown): Response { return Response.json(value); }
test("Topaz Enhance generation preflights exact quote twice, dispatches once, and permits GET recovery past source TTL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-generation-1986-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\",\"duration\":\"3.0\",\"disposition\":{\"attached_pic\":0}}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.0\"}}'\n"); await chmod(ffprobe, 0o700);
  const trustedFfprobe = await realpath(ffprobe);
  let clock = 1_000_000, balanceReads = 0, quotes = 0, chatCalls = 0, genCalls = 0, historyCalls = 0, resultCalls = 0;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-enhance-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-linked-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => clock), { now: () => clock, attemptIdGenerator: () => ATTEMPT });
  const created = await links.createAttempt(BINDING); await links.issueHandoff(BINDING, created.attempt_id); await links.checkAttempt(BINDING, created.attempt_id);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) { return links.useCredential(BINDING, ATTEMPT, value => operation(value.value)); } };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return response({ balance: balanceReads++ === 0 ? "1.00" : "1" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") {
      quotes++; assert.equal(url.searchParams.get("ai_name"), "topaz_ai"); assert.equal(url.searchParams.get("model_type"), "topaz_enhance");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "1"); assert.equal(url.searchParams.get("video_duration"), "3");
      return response({ access: true, cost: quotes === 1 ? 2 : 0.5, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success", size: SOURCE.byteLength, content_type: "video/mp4", duration: 3 }] });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCalls++; return response({ uuid: CHAT }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      genCalls++; assert.equal(url.search, "?ai_name=topaz_ai"); const body = JSON.parse(String(init.body)) as Record<string, any>;
      assert.equal(body.chat_id, CHAT); assert.equal(Object.hasOwn(body, "prompt"), false); assert.equal(body.settings.model_type, "topaz_enhance");
      assert.equal(body.settings.video_duration, 3); assert.equal(body.settings.resolution, "1"); assert.equal(body.settings.width, 640); assert.equal(body.settings.height, 360);
      assert.deepEqual(body.settings.file_urls, [{ type: "video", url: SOURCE_URL }]); assert.equal(body.settings.parameters.upscale, 1); return response({ id: ACK });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/messages`) && method === "GET") { historyCalls++; if (historyCalls === 1) throw new Error("synthetic interrupted history read"); return response({ messages: [
      { id: ACK, chat_id: 77201, author_id: 17, message_object: [] }, { id: MESSAGE, chat_id: 77201, author_id: -1,
        message_object: [{ id: OBJECT, message_id: MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "topaz_enhance" }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } }); }
    if (url.pathname.endsWith(`/chats/${CHAT}/${MESSAGE}`) && method === "GET") { resultCalls++; return response({ id: MESSAGE, chat_id: 77201, author_id: -1,
      message_object: [{ id: OBJECT, message_id: MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "topaz_enhance" }] }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const chat = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const original = new OwnerTopazEnhanceOriginalReferenceService({ ffprobePath: trustedFfprobe, destination: "hidden", binding: BINDING, linkService: links, resolveClient: () => chat, now: () => clock });
  const preparer = createOwnerTopazEnhanceOwnedRequestPreparer({ originalReferenceService: original, now: () => clock });
  const service = new OwnerTopazEnhanceGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    preparer, originalReferenceService: original, resolveChatClient: () => chat, now: () => clock,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => clock),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => clock) });
  try {
    const uploaded = await original.uploadOriginal({ attemptId: ATTEMPT, model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
    const request = { attemptId: ATTEMPT, request: { model_id: "topaz_enhance" as const, topaz_original_handle: uploaded.topaz_original_handle,
      parameters: { blur: 0, halo: 0, focus: "off", grain: "off", model: "rhea-1", noise: 0, details: 0, preblur: 0, upscale: 1, prenoise: 0, compression: 0, interpolation: 60 } } };
    await assert.rejects(service.generate(request), (error: unknown) => error instanceof OwnerTopazEnhanceGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(chatCalls, 0); assert.equal(genCalls, 0, "quote 2 must not pass a balance of 1.00");
    const unknown = await service.generate(request).then(() => null, (error: unknown) => error);
    assert.ok(unknown instanceof OwnerTopazEnhanceGenerationServiceError); assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.ok(unknown.recovery_id); assert.equal(quotes, 3); assert.equal(chatCalls, 1); assert.equal(genCalls, 1);
    await assert.rejects(service.generate(request),
      (error: unknown) => error instanceof OwnerTopazEnhanceGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(genCalls, 1, "the same semantic intent is not posted twice");
    clock += 16 * 60_000;
    const result = await service.reconcile({ attemptId: ATTEMPT, recovery_id: unknown.recovery_id! });
    assert.equal(result.status, "completed"); assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.cost_cap_enforced, false);
    assert.equal(result.artifacts[0]?.object_url, RESULT_URL); assert.equal(historyCalls, 2); assert.equal(resultCalls, 1); assert.equal(quotes, 3);
  } finally { await service.close(); await original.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Topaz Enhance accepts a fresh active subscription with unknown expiry but blocks an expired one before chat", async () => {
  const expiryAttempt = "link_topaz_enhance_expiry_1991_0123456789";
  const expiryBinding: AuthBinding = Object.freeze({ tenant_id: "topaz-enhance-expiry-tenant", subject: "expiry-owner" });
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-expiry-1991-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\",\"duration\":\"3.0\",\"disposition\":{\"attached_pic\":0}}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.0\"}}'\n"); await chmod(ffprobe, 0o700);
  const trustedFfprobe = await realpath(ffprobe), clock = Date.now();
  let endDate: string | null = null, quoteReads = 0, chatCalls = 0, generationCalls = 0;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-expiry-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-linked-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => clock), { now: () => clock, attemptIdGenerator: () => expiryAttempt });
  const created = await links.createAttempt(expiryBinding); await links.issueHandoff(expiryBinding, created.attempt_id); await links.checkAttempt(expiryBinding, created.attempt_id);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) { return links.useCredential(expiryBinding, expiryAttempt, value => operation(value.value)); } };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return response({ balance: "10" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: true, type: "PRO", end_date: endDate });
    if (url.pathname === "/api/v2/get_model_info") { quoteReads++; return response({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success", size: SOURCE.byteLength, content_type: "video/mp4", duration: 3 }] });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCalls++; return new Response("synthetic rejected chat creation", { status: 503 }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { generationCalls++; return response({ id: ACK }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const chat = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const original = new OwnerTopazEnhanceOriginalReferenceService({ ffprobePath: trustedFfprobe, destination: "hidden", binding: expiryBinding, linkService: links, resolveClient: () => chat, now: () => clock });
  const preparer = createOwnerTopazEnhanceOwnedRequestPreparer({ originalReferenceService: original, now: () => clock });
  const service = new OwnerTopazEnhanceGenerationService({ binding: expiryBinding, linkService: links, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    preparer, originalReferenceService: original, resolveChatClient: () => chat, now: () => clock,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => clock),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => clock) });
  try {
    const uploaded = await original.uploadOriginal({ attemptId: expiryAttempt, model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
    const request = (interpolation: 60 | 50) => ({ attemptId: expiryAttempt, request: { model_id: "topaz_enhance" as const, topaz_original_handle: uploaded.topaz_original_handle,
      parameters: { blur: 0, halo: 0, focus: "off" as const, grain: "off" as const, model: "rhea-1" as const, noise: 0, details: 0, preblur: 0, upscale: 1 as const, prenoise: 0, compression: 0, interpolation } } });
    const nullExpiryOutcome = await service.generate(request(60)).then(() => null, (error: unknown) => error);
    assert.ok(nullExpiryOutcome instanceof OwnerTopazEnhanceGenerationServiceError);
    assert.equal(nullExpiryOutcome.code, "PRE_DISPATCH_FAILED", "unknown expiry on an active subscription must not fail account preflight");
    assert.equal(quoteReads, 1, "active subscription with null expiry must pass account preflight and reach the synthetic chat request");
    assert.equal(chatCalls, 1); assert.equal(generationCalls, 0);
    endDate = "2000-01-01T00:00:00.000Z";
    await assert.rejects(service.generate(request(50)), (error: unknown) => error instanceof OwnerTopazEnhanceGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(quoteReads, 2); assert.equal(chatCalls, 1, "an expired subscription must not create a second chat"); assert.equal(generationCalls, 0);
  } finally { await service.close(); await original.close(); await rm(directory, { recursive: true, force: true }); }
});
