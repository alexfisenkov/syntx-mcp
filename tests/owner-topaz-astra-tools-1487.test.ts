import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerTopazAstraGenerationService, isOwnerTopazAstraGenerationService } from "../src/application/owner-topaz-astra-generation-service.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import { createOwnerTopazAstraOwnedRequestPreparer } from "../src/application/owner-topaz-astra-owned-request-preparer.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_TOPAZ_ASTRA_MODEL_IDS } from "../src/application/owner-topaz-astra-source-profile.js";
import { registerSyntxOwnerTopazAstraTools, OWNER_TOPAZ_ASTRA_TOOL_NAMES } from "../src/mcp/owner-topaz-astra-tools.js";

test("1487 requires the genuine Topaz generation service and keeps the model set source-pinned", async () => {
  assert.deepEqual(OWNER_TOPAZ_ASTRA_MODEL_IDS, ["slc-1", "slf-2", "slp-2", "slp-2.5"]);
  assert.equal(isOwnerTopazAstraGenerationService({}), false);
  const server = new McpServer({ name: "topaz-1487", version: "1.0.0" });
  assert.throws(() => registerSyntxOwnerTopazAstraTools(server, {
      generationService: {}, originalReferenceService: {}
  }), /TOPAZ_ASTRA_SERVICE_COMPOSITION_INVALID/u);
  assert.equal(OWNER_TOPAZ_ASTRA_TOOL_NAMES.length, 6);
  await server.close();
});

test("1487 official MCP SDK uploads one source and follows the genuine one-shot generation/result path", async () => {
  const attempt = "link_topaz_tools_owner_1487_0123456789", binding: AuthBinding = Object.freeze({ tenant_id: "topaz-tools-tenant", subject: "topaz-tools-owner" });
  const source = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34]);
  const chat = "topaz-tools-chat", ack = "topaz-tools-ack", message = "topaz-tools-result", object = "topaz-tools-object";
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion("sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json", join(process.cwd(), "catalog")));
  const dir = await mkdtemp(join(tmpdir(), "topaz-tools-1487-")), ffprobe = join(dir, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n"); await chmod(ffprobe, 0o700);
  let now = Date.now(), posts = 0;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-1487", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-topaz-1487" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now), links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => attempt });
  await links.createAttempt(binding); await links.issueHandoff(binding, attempt); await links.checkAttempt(binding, attempt);
  const broker: SyntxCredentialBroker = { async useCredential<T>(fn: (credential: string) => Promise<T>) { return links.useCredential(binding, attempt, (value) => fn(value.value)); } };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 12, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname.endsWith("/chats/upload-files")) return Response.json({ files: [{ filename: "source.mp4", url: "https://r2.syntx.ai/topaz/source.mp4",
      status: "success", size: source.byteLength, content_type: "video/mp4", duration: 3.2 }] });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: chat });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { posts++; return Response.json({ id: ack }); }
    if (url.pathname.endsWith(`/chats/${chat}/messages`)) return Response.json({ messages: [
      { id: ack, chat_id: 77201, author_id: 17, message_object: [] }, { id: message, chat_id: 77201, author_id: -1,
        message_object: [{ id: object, message_id: message, object_type: "video", object_url: "https://r2.syntx.ai/topaz/result.mp4", model_type: "slc-1", completed: true }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    if (url.pathname.endsWith(`/chats/${chat}/${message}`)) return Response.json({ id: message, chat_id: 77201, author_id: -1,
      message_object: [{ id: object, message_id: message, object_type: "video", object_url: "https://r2.syntx.ai/topaz/result.mp4", completed: true, model_type: "slc-1" }] });
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const original = new OwnerTopazAstraOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding, linkService: links,
    resolveClient: () => chatClient, now: () => now });
  const preparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: original, now: () => now });
  const generation = new OwnerTopazAstraGenerationService({ binding, linkService: links, catalog,
    catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json", preparer,
    originalReferenceService: original, resolveChatClient: () => chatClient, now: () => now,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl })),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: broker, fetchImpl })) });
  const server = new McpServer({ name: "topaz-tools-1487", version: "1.0.0" }), client = new Client({ name: "topaz-tools-sdk-1487", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    registerSyntxOwnerTopazAstraTools(server, { generationService: generation, originalReferenceService: original });
    await server.connect(serverTransport); await client.connect(clientTransport);
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name), OWNER_TOPAZ_ASTRA_TOOL_NAMES);
    const bad = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[1], arguments: { link_attempt_id: attempt, model_id: "slc-1",
      filename: "source.mp4", mime_type: "video/mp4", content_base64: Buffer.from(source).toString("base64"), url: "https://example.invalid/source.mp4" } });
    assert.equal(bad.isError, true); assert.equal(posts, 0);
    const uploaded = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[1], arguments: { link_attempt_id: attempt, model_id: "slc-1",
      filename: "source.mp4", mime_type: "video/mp4", content_base64: Buffer.from(source).toString("base64") } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    const handle = (uploaded.structuredContent as { topaz_original_handle: string }).topaz_original_handle;
    assert.match(handle, /^topaz_astra_original_[0-9a-f-]{36}$/u);
    const generated = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[2], arguments: { link_attempt_id: attempt, model_id: "slc-1",
      topaz_original_handle: handle, prompt: "Keep motion natural.", parameters: { resolution: "1920x1080", frame_rate: 24, slowmo: null, creativity: "middle" } } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated)); assert.equal(posts, 1);
    const page = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[5], arguments: { link_attempt_id: attempt,
      recovery_id: (generated.structuredContent as { recovery_id: string }).recovery_id } });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    assert.equal((page.structuredContent as { artifacts: Array<{ object_url: string }> }).artifacts[0]?.object_url, "https://r2.syntx.ai/topaz/result.mp4");
  } finally { await Promise.allSettled([client.close(), server.close(), generation.close(), original.close(), store.close()]); await rm(dir, { recursive: true, force: true }); }
});
