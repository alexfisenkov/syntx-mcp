import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerHailuo02I2vImageReferenceService } from "../src/application/owner-hailuo02-i2v-image-reference-service.js";
import { createOwnerHailuo02I2vRequestPreparer } from "../src/application/owner-hailuo02-i2v-request-preparer.js";
import { OwnerHailuo02I2vGenerationService, OwnerHailuo02I2vGenerationServiceError } from "../src/application/owner-hailuo02-i2v-generation-service.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_HAILUO02_I2V_SOURCE_PROFILE } from "../src/application/owner-hailuo02-i2v-source-profile.js";

const ATTEMPT = "link_hailuo_service_1501_0123456789";
const FOREIGN_ATTEMPT = "link_hailuo_foreign_1501_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "hailuo-service-tenant", subject: "hailuo-service-owner" });
const FOREIGN_BINDING: AuthBinding = Object.freeze({ tenant_id: "hailuo-foreign-tenant", subject: "hailuo-foreign-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const INPUT_URL = "https://r2.syntx.ai/hailuo/service-input.png", OUTPUT_URL = "https://r2.syntx.ai/hailuo/service-output.mp4";
const CHAT = "hailuo-service-chat", ACK = "hailuo-service-ack", MESSAGE = "hailuo-service-result", OBJECT = "hailuo-service-video";
const CATALOG_VERSION = OWNER_HAILUO02_I2V_SOURCE_PROFILE.source_pins.public_catalog_version;
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_HAILUO02_I2V_SOURCE_PROFILE.source_pins.public_catalog_version, `${process.cwd()}/catalog`));
function response(value: unknown): Response { return Response.json(value); }
function errorCode(error: unknown): string | undefined { return error instanceof OwnerHailuo02I2vGenerationServiceError ? error.code : undefined; }

test("Hailuo02 I2V service double-preflights, claims by owner+image intent, and recovers uncertain post with GET only", async () => {
  let clock = Date.now(), quoteReads = 0, chats = 0, generations = 0, historyGets = 0, resultGets = 0, failNextHistory = false;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "hailuo-service-upstream", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => clock); let attemptIndex = 0;
  const linkAttempts = [ATTEMPT, FOREIGN_ATTEMPT];
  const links = new PerUserLinkService(provider, store,
    { now: () => clock, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => linkAttempts[attemptIndex++]! });
  const link = async (service: PerUserLinkService, binding: AuthBinding, attempt: string) => {
    const created = await service.createAttempt(binding); await service.issueHandoff(binding, created.attempt_id); await service.checkAttempt(binding, attempt);
  };
  await link(links, BINDING, ATTEMPT); await link(links, FOREIGN_BINDING, FOREIGN_ATTEMPT);
  let deniedQuote = true, currentChat = CHAT;
  const chatIds = new Set<string>();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return response({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") {
      quoteReads++; assert.equal(url.searchParams.get("ai_name"), "hailuo-minimax"); assert.equal(url.searchParams.get("model_type"), "hailuo-02");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "768p"); assert.equal(url.searchParams.get("video_duration"), "6");
      return response({ access: !(deniedQuote && quoteReads === 1), cost: 12, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname.endsWith("/chats/upload-files")) {
      const form = init.body as FormData; assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      const file = form.get("files"); assert.ok(file instanceof File); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      return response({ files: [{ filename: file.name, url: INPUT_URL, mime_type: "image/png", size: PNG.byteLength, status: "success" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { chats++; currentChat = chats === 1 ? CHAT : `${CHAT}-${chats}`; chatIds.add(currentChat); return response({ uuid: currentChat }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generations++; const body = JSON.parse(String(init.body)) as Record<string, any>;
      assert.equal(url.search, "?ai_name=hailuo-minimax"); assert.deepEqual(Object.keys(body), ["chat_id", "prompt", "settings"]);
      assert.equal(body.chat_id, currentChat); assert.equal(body.settings.model_type, "hailuo-02"); assert.equal(body.settings.resolution, "768p");
      assert.equal(body.settings.video_duration, 6); assert.deepEqual(body.settings.file_urls, [{ type: "image", url: INPUT_URL }]);
      assert.equal(body.prompt, generations === 1 ? "A quiet synthetic scene." : "A second synthetic motion."); assert.equal(Object.hasOwn(body.settings, "n"), false);
      return response({ id: ACK });
    }
    const historyMatch = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (historyMatch && method === "GET" && chatIds.has(historyMatch[1]!)) { historyGets++;
      if (failNextHistory) { failNextHistory = false; throw new Error("synthetic history GET interruption"); }
      return response({ messages: [{ id: ACK, chat_id: 77202, author_id: 17, message_object: [] },
        { id: MESSAGE, chat_id: 77202, author_id: -1, message_object: [{ id: OBJECT, message_id: MESSAGE, object_type: "video",
          object_url: OUTPUT_URL, completed: true, model_type: "hailuo-02" }] }],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (resultMatch && resultMatch[2] === MESSAGE && chatIds.has(resultMatch[1]!) && method === "GET") { resultGets++;
      return response({ id: MESSAGE, chat_id: 77202, author_id: -1, message_object: [{ id: OBJECT, message_id: MESSAGE, object_type: "video",
        object_url: OUTPUT_URL, completed: true, model_type: "hailuo-02" }] });
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (value) => operation(value.value)); } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const images = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: links, resolveClient: () => chatClient, now: () => clock });
  const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => clock });
  const service = new OwnerHailuo02I2vGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, imageReferenceService: images, resolveChatClient: () => chatClient, now: () => clock,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => clock),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => clock) });
  try {
    const image1 = await images.uploadImage({ attemptId: ATTEMPT, filename: "frame.png", mime_type: "image/png", bytes: new Uint8Array(PNG) });
    const image2 = await images.uploadImage({ attemptId: ATTEMPT, filename: "same-content.png", mime_type: "image/png", bytes: new Uint8Array(PNG) });
    const input = (prompt: string, image_handle: string) => ({ attemptId: ATTEMPT,
      request: { model_id: "hailuo-02", prompt, resolution: "768p", video_duration: 6, image_handle } });
    await assert.rejects(service.generate(input("Denied before free chat.", image1.image_handle)), (error) => errorCode(error) === "PREFLIGHT_FAILED");
    assert.equal(chats, 0); assert.equal(generations, 0, "a denied live quote must stop before free chat and generation");
    deniedQuote = false;
    const completed = await service.generate(input("A quiet synthetic scene.", image1.image_handle));
    assert.equal(completed.status, "completed"); assert.equal(completed.backend_acceptance, "UNPROVEN"); assert.equal(completed.cost_cap_enforced, false);
    assert.equal(generations, 1); assert.equal(quoteReads, 3);
    await assert.rejects(service.generate(input("A quiet synthetic scene.", image2.image_handle)),
      (error) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
    assert.equal(chats, 1); assert.equal(generations, 1, "identical image content under a different handle stays claimed");

    failNextHistory = true;
    const unknown = await service.generate(input("A second synthetic motion.", image1.image_handle)).then(() => null, (error: unknown) => error);
    assert.ok(unknown instanceof OwnerHailuo02I2vGenerationServiceError); assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.equal(generations, 2); await assert.rejects(service.generate(input("A second synthetic motion.", image1.image_handle)),
      (error) => errorCode(error) === "INTENT_ALREADY_CLAIMED"); assert.equal(generations, 2);
    clock += 16 * 60_000;
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: unknown.recovery_id! });
    assert.equal(recovered.status, "completed"); assert.equal(recovered.artifacts.length, 1); assert.equal(recovered.artifacts[0]?.object_url, OUTPUT_URL);
    assert.equal(recovered.artifacts[0]?.mime_source, "URL_EXTENSION_LOCAL_POLICY");
    assert.equal(quoteReads, 5); assert.equal(chats, 2); assert.equal(generations, 2); assert.equal(historyGets, 3); assert.equal(resultGets, 2);
    await assert.rejects(service.listRecoveries({ attemptId: FOREIGN_ATTEMPT }), (error) => errorCode(error) === "PRINCIPAL_NOT_LINKED");
  } finally { await service.close(); await images.close(); await preparer.close(); await store.close(); }
});

