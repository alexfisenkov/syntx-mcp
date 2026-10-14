import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import { createOwnerTopazAstraOwnedRequestPreparer } from "../src/application/owner-topaz-astra-owned-request-preparer.js";
import { OwnerTopazAstraGenerationService, OwnerTopazAstraGenerationServiceError } from "../src/application/owner-topaz-astra-generation-service.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_topaz_service_owner_1484_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "topaz-service-tenant", subject: "topaz-service-owner" });
const SOURCE = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34]);
const SOURCE_URL = "https://r2.syntx.ai/topaz/service-source.mp4", RESULT_URL = "https://r2.syntx.ai/topaz/service-result.mp4";
const CHAT = "topaz-service-chat", ACK = "topaz-service-ack", MESSAGE = "topaz-service-result", OBJECT = "topaz-service-object";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion("sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json", join(process.cwd(), "catalog")));
function response(value: unknown): Response { return Response.json(value); }
function errorCode(error: unknown): string | undefined { return error instanceof OwnerTopazAstraGenerationServiceError ? error.code : undefined; }

test("Topaz owner generation service preflights twice, dispatches once, binds GET recovery, and keeps ownership cleanup scoped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-service-1484-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n"); await chmod(ffprobe, 0o700);
  let clock = Date.now(), credential = "synthetic-owner-token", modelQuotes = 0, chats = 0, generations = 0, historyGets = 0, resultGets = 0, historyFailures = 1;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "topaz-service-upstream", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: credential }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => clock), links = new PerUserLinkService(provider, store,
    { now: () => clock, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  const attempts = await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attempts.attempt_id); await links.checkAttempt(BINDING, attempts.attempt_id);
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return response({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") {
      modelQuotes++; assert.equal(url.searchParams.get("ai_name"), "topaz_astra"); assert.equal(url.searchParams.get("model_type"), "slc-1");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "frame_rate", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("video_duration"), "3"); assert.equal(url.searchParams.get("frame_rate"), "24");
      assert.equal(url.searchParams.get("resolution"), "1920x1080");
      return response({ access: modelQuotes !== 1, cost: 14, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ filename: "source.mp4", url: SOURCE_URL,
      status: "success", size: SOURCE.byteLength, content_type: "video/mp4", duration: 3.2 }] });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chats++; return response({ uuid: CHAT }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generations++; assert.equal(url.search, "?ai_name=topaz_astra"); const body = JSON.parse(String(init.body)) as Record<string, any>;
      assert.equal(body.chat_id, CHAT); assert.equal(body.prompt, "Keep motion natural."); assert.equal(body.settings.model_type, "slc-1");
      assert.equal(body.settings.video_duration, 3); assert.deepEqual(body.settings.resolution, { width: 1920, height: 1080 });
      assert.equal(body.settings.frame_rate, 24); assert.equal(body.settings.slowmo, null); assert.equal(body.settings.creativity, "middle");
      assert.equal(Object.hasOwn(body.settings, "n"), false); assert.deepEqual(body.settings.file_urls, [{ type: "video", url: SOURCE_URL }]);
      return response({ id: ACK });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/messages`) && method === "GET") { historyGets++;
      if (historyFailures-- > 0) throw new Error("synthetic history read interruption");
      return response({ messages: [
      { id: ACK, chat_id: 77201, author_id: 17, message_object: [] }, { id: MESSAGE, chat_id: 77201, author_id: -1,
        message_object: [{ id: OBJECT, message_id: MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "slc-1" }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } }); }
    if (url.pathname.endsWith(`/chats/${CHAT}/${MESSAGE}`) && method === "GET") { resultGets++; return response({ id: MESSAGE, chat_id: 77201,
      author_id: -1, message_object: [{ id: OBJECT, message_id: MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "slc-1" }] }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (value) => operation(value.value)); } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const original = new OwnerTopazAstraOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => chatClient, now: () => clock });
  const preparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: original, now: () => clock });
  const service = new OwnerTopazAstraGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
    preparer, originalReferenceService: original, resolveChatClient: () => chatClient,
    now: () => clock,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl })),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl })) });
  try {
    const uploaded = await original.uploadOriginal({ attemptId: ATTEMPT, model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
    const input = { attemptId: ATTEMPT, request: { model_id: "slc-1", topaz_original_handle: uploaded.topaz_original_handle,
      prompt: "Keep motion natural.", parameters: { resolution: "1920x1080", frame_rate: 24, slowmo: null, creativity: "middle" } } };
    await assert.rejects(service.generate(input), (error) => errorCode(error) === "PREFLIGHT_FAILED");
    assert.equal(chats, 0); assert.equal(generations, 0, "denied live quote must stop before free chat and generation");
    const unknown = await service.generate(input).then(() => null, (error: unknown) => error);
    assert.ok(unknown instanceof OwnerTopazAstraGenerationServiceError); assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.equal(generations, 1); assert.equal(modelQuotes, 3); assert.equal(chats, 1);
    await assert.rejects(service.generate(input), (error) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
    assert.equal(generations, 1, "same semantic intent stays claimed and cannot post twice");
    clock += 16 * 60_000;
    const result = await service.reconcile({ attemptId: ATTEMPT, recovery_id: unknown.recovery_id! });
    assert.equal(result.status, "completed"); assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.cost_cap_enforced, false);
    assert.equal(result.artifacts.length, 1); assert.equal(result.artifacts[0]?.object_url, RESULT_URL);
    assert.equal(modelQuotes, 3); assert.equal(chats, 1); assert.equal(generations, 1); assert.equal(historyGets, 2); assert.equal(resultGets, 1);
    assert.equal(JSON.stringify(result).includes(SOURCE_URL), false); assert.equal(JSON.stringify(result).includes(RESULT_URL), true);
    await service.close();
    // The service closes its exclusively owned preparer, while the original-reference service is borrowed.
    assert.equal(typeof original.resolveOriginal, "function");
  } finally { await service.close(); await original.close(); await store.close(); await rm(directory, { recursive: true, force: true }); }
});
