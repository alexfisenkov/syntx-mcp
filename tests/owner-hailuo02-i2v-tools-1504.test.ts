import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerHailuo02I2vImageReferenceService } from "../src/application/owner-hailuo02-i2v-image-reference-service.js";
import { OwnerHailuo02I2vGenerationService } from "../src/application/owner-hailuo02-i2v-generation-service.js";
import { createOwnerHailuo02I2vRequestPreparer } from "../src/application/owner-hailuo02-i2v-request-preparer.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_HAILUO02_I2V_SOURCE_PROFILE } from "../src/application/owner-hailuo02-i2v-source-profile.js";
import { OWNER_HAILUO02_I2V_TOOL_NAMES, registerSyntxOwnerHailuo02I2vTools } from "../src/mcp/owner-hailuo02-i2v-tools.js";

const ATTEMPT = "link_hailuo_tools_1504_0123456789", BINDING: AuthBinding = Object.freeze({ tenant_id: "h02-tools-tenant", subject: "h02-tools-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const INPUT_URL = "https://r2.syntx.ai/hailuo/tools-input.png", OUTPUT_URL = "https://r2.syntx.ai/hailuo/tools-output.mp4";
const CATALOG_VERSION = OWNER_HAILUO02_I2V_SOURCE_PROFILE.source_pins.public_catalog_version;
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, `${process.cwd()}/catalog`));

test("1504 registers six owner-only tools with genuine services and rejects forged compositions", async () => {
  const server = new McpServer({ name: "hailuo-i2v-1504-invalid", version: "1.0.0" });
  assert.throws(() => registerSyntxOwnerHailuo02I2vTools(server, { imageReferenceService: {}, generationService: {} }), /INVALID_HAILUO02_I2V_SERVICE_COMPOSITION/u);
  await server.close();
  assert.equal(OWNER_HAILUO02_I2V_TOOL_NAMES.length, 6);
  assert.deepEqual(OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.valid_pairs.map((p) => [p.resolution, p.video_duration]),
    [["512p", 6], ["512p", 10], ["768p", 6], ["768p", 10], ["1080p", 6]]);
});

test("1504 official MCP SDK upload→one GEN→GET output uses real Hailuo services", async () => {
  let now = Date.now(), gens = 0, uploads = 0, histories = 0, results = 0;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "h02-tools-1504", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-h02-token" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now), links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const broker: SyntxCredentialBroker = { async useCredential<T>(fn: (credential: string) => Promise<T>) { return links.useCredential(BINDING, ATTEMPT, (v) => fn(v.value)); } };
  const chat = "h02-tools-chat", ack = "h02-tools-ack", message = "h02-tools-message", object = "h02-tools-object";
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 12, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname.endsWith("/chats/upload-files")) { uploads++; const form = init.body as FormData; const file = form.get("files"); assert.ok(file instanceof File);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG); return Response.json({ files: [{ filename: file.name, url: INPUT_URL, mime_type: "image/png", size: PNG.length, status: "success" }] }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: chat });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { gens++; const body = JSON.parse(String(init.body));
      assert.equal(body.settings.model_type, "hailuo-02"); assert.equal(body.settings.resolution, "768p"); assert.equal(body.settings.video_duration, 6);
      assert.deepEqual(body.settings.file_urls, [{ type: "image", url: INPUT_URL }]); return Response.json({ id: ack }); }
    if (url.pathname === `/api/v1/chats/${chat}/messages` && method === "GET") { histories++; return Response.json({ messages: [
      { id: ack, chat_id: 77203, author_id: 17, message_object: [] }, { id: message, chat_id: 77203, author_id: -1,
        message_object: [{ id: object, message_id: message, object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "hailuo-02" }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } }); }
    if (url.pathname === `/api/v1/chats/${chat}/${message}` && method === "GET") { results++; return Response.json({ id: message, chat_id: 77203, author_id: -1,
      message_object: [{ id: object, message_id: message, object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "hailuo-02" }] }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const images = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: links, resolveClient: () => chatClient, now: () => now });
  const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => now });
  const generation = new OwnerHailuo02I2vGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    preparer, imageReferenceService: images, resolveChatClient: () => chatClient, now: () => now,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl })),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl })) });
  const server = new McpServer({ name: "hailuo-i2v-1504", version: "1.0.0" }), client = new Client({ name: "hailuo-i2v-sdk-1504", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    registerSyntxOwnerHailuo02I2vTools(server, { imageReferenceService: images, generationService: generation }); await server.connect(st); await client.connect(ct);
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name), OWNER_HAILUO02_I2V_TOOL_NAMES);
    const parameters = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[0], arguments: {} });
    assert.equal(parameters.isError, undefined); assert.equal((parameters.structuredContent as { runtime_usable: boolean }).runtime_usable, false);
    const invalid = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, filename: "frame.png", mime_type: "image/png", content_base64: PNG.toString("base64"), path: "/tmp/frame.png" } });
    assert.equal(invalid.isError, true); assert.equal(uploads, 0); assert.equal(gens, 0);
    const uploaded = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT, filename: "frame.png", mime_type: "image/png", content_base64: PNG.toString("base64") } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded)); assert.equal(Number(uploads), 1, "upload must be invoked once");
    const image_handle = (uploaded.structuredContent as { image_handle: string }).image_handle;
    const badPair = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, model_id: "hailuo-02", image_handle, prompt: "Synthetic motion", resolution: "1080p", video_duration: 10 } });
    assert.equal(badPair.isError, true); assert.equal(gens, 0);
    const generated = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, model_id: "hailuo-02", image_handle, prompt: "Synthetic motion", resolution: "768p", video_duration: 6 } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated)); assert.equal(gens, 1);
    const result = generated.structuredContent as { recovery_id: string; backend_acceptance: string; artifacts: Array<{ mime_source: string; object_url: string }> };
    assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL); assert.equal(result.artifacts[0]?.mime_source, "URL_EXTENSION_LOCAL_POLICY");
    const listed = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed)); assert.equal((listed.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
    const reconciled = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled)); assert.equal(gens, 1, "reconciliation must not repeat generation");
    const page = await client.callTool({ name: OWNER_HAILUO02_I2V_TOOL_NAMES[5], arguments: { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id } });
    assert.equal(page.isError, undefined, JSON.stringify(page)); assert.equal(gens, 1); assert.equal(histories, 1); assert.equal(results, 1);
  } finally { await Promise.allSettled([client.close(), server.close(), generation.close(), images.close(), store.close()]); }
});
