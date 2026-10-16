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
import { OwnerTopazAstraGenerationService } from "../src/application/owner-topaz-astra-generation-service.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import { createOwnerTopazAstraOwnedRequestPreparer } from "../src/application/owner-topaz-astra-owned-request-preparer.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { registerSyntxOwnerTopazAstraTools, OWNER_TOPAZ_ASTRA_TOOL_NAMES } from "../src/mcp/owner-topaz-astra-tools.js";

const ATTEMPT = "link_topaz_http_status_2184_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "topaz-http-status-tenant", subject: "topaz-http-status-owner" });
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, join(process.cwd(), "catalog")));
const SOURCE = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34]);
const SOURCE_URL = "https://r2.syntx.ai/topaz/http-status-source.mp4";
const CHAT = "topaz-http-status-chat";
const CHAT_SECOND = "topaz-http-status-chat-second";
const UNKNOWN_BODY = "SYNTHETIC_DETAIL_MUST_NEVER_ESCAPE";

function jsonResponse(value: unknown): Response { return Response.json(value); }
function failureResponse(status: number, onCancel: () => void): Response {
  const bytes = new TextEncoder().encode(JSON.stringify({ detail: [{ msg: UNKNOWN_BODY, input: "must-not-be-read" }] }));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); },
    cancel() { onCancel(); }
  }), { status, headers: { "content-type": "application/json" } });
}
async function linkedOwner(clock: () => number): Promise<{ links: PerUserLinkService; store: InMemoryAuthLinkStore }> {
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-http-status", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(clock), links = new PerUserLinkService(provider, store,
    { now: clock, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  return { links, store };
}

test("Topaz Astra 422 stays unknown, exposes only its fixed status marker, and reconciles GET-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "topaz-http-status-2184-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n");
  await chmod(ffprobe, 0o700);
  let now = Date.now(), generationPosts = 0, historyGets = 0, cancelledBodies = 0, createdChats = 0, upload422 = false, history422 = false;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return jsonResponse({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return jsonResponse({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return jsonResponse({ access: true, cost: 12, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname.endsWith("/chats/upload-files") && method === "POST") {
      if (upload422) return failureResponse(422, () => { cancelledBodies++; });
      return jsonResponse({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success", size: SOURCE.byteLength,
        content_type: "video/mp4", duration: 3.2 }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { createdChats++; return jsonResponse({ uuid: createdChats === 1 ? CHAT : CHAT_SECOND }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationPosts++; assert.equal(url.search, "?ai_name=topaz_astra");
      const body = JSON.parse(String(init.body)) as { chat_id: string };
      assert.equal(body.chat_id, generationPosts === 1 ? CHAT : CHAT_SECOND);
      return failureResponse(generationPosts === 1 ? 422 : 500, () => { cancelledBodies++; });
    }
    if (url.pathname.startsWith("/api/v1/chats/") && url.pathname.endsWith("/messages") && method === "GET") {
      historyGets++;
      if (history422) return failureResponse(422, () => { cancelledBodies++; });
      return jsonResponse({ messages: [{ id: "unrelated-owner-message", chat_id: 77201, author_id: 17, message_object: [] }],
        pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_previous: false, has_next: false } });
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const { links, store } = await linkedOwner(() => now);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const original = new OwnerTopazAstraOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => chatClient, now: () => now });
  const preparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: original, now: () => now });
  const generation = new OwnerTopazAstraGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, originalReferenceService: original, resolveChatClient: () => chatClient, now: () => now,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl })),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl })) });
  const server = new McpServer({ name: "topaz-http-status-2184", version: "1.0.0" });
  const client = new Client({ name: "topaz-http-status-sdk-2184", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    registerSyntxOwnerTopazAstraTools(server, { generationService: generation, originalReferenceService: original });
    await server.connect(serverTransport); await client.connect(clientTransport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), OWNER_TOPAZ_ASTRA_TOOL_NAMES);
    const uploaded = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[1]!, arguments: { link_attempt_id: ATTEMPT,
      model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", content_base64: Buffer.from(SOURCE).toString("base64") } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    const handle = (uploaded.structuredContent as { topaz_original_handle: string }).topaz_original_handle;
    upload422 = true;
    const unrelated422 = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[1]!, arguments: { link_attempt_id: ATTEMPT,
      model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", content_base64: Buffer.from(SOURCE).toString("base64") } });
    upload422 = false;
    assert.equal(unrelated422.isError, true);
    const unrelatedText = (unrelated422.content as Array<{ text: string }>)[0]!.text;
    assert.doesNotMatch(unrelatedText, /HTTP_422_OBSERVED|SYNTHETIC_DETAIL_MUST_NEVER_ESCAPE|must-not-be-read/u,
      "other 422 routes retain their old generic output and never expose body data");
    const input = { link_attempt_id: ATTEMPT, model_id: "slc-1", topaz_original_handle: handle,
      prompt: "Keep motion natural.", parameters: { resolution: "1920x1080", frame_rate: 24, slowmo: null, creativity: "middle" } };
    const generated = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[2]!, arguments: input });
    assert.equal(generated.isError, true);
    const generatedText = (generated.content as Array<{ text: string }>)[0]!.text;
    const generationPayload = JSON.parse(generatedText) as { error: { code: string; recovery_id?: string;
      diagnostic?: { post_started: boolean; ack_known: boolean; http_status_observed?: string } } };
    assert.equal(generationPayload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(generationPayload.error.diagnostic?.post_started, true);
    assert.equal(generationPayload.error.diagnostic?.ack_known, false);
    assert.equal(generationPayload.error.diagnostic?.http_status_observed, "HTTP_422_OBSERVED");
    assert.doesNotMatch(generatedText, /SYNTHETIC_DETAIL_MUST_NEVER_ESCAPE|must-not-be-read|"status"\s*:\s*422/u);
    assert.ok(generationPayload.error.recovery_id);
    assert.equal(generationPosts, 1); assert.equal(createdChats, 1);

    const replay = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[2]!, arguments: input });
    assert.equal(replay.isError, true); assert.equal(generationPosts, 1, "the same intent cannot dispatch a second POST");

    const otherStatus = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[2]!, arguments: { ...input,
      prompt: "Make the motion calmer." } });
    assert.equal(otherStatus.isError, true);
    const otherStatusText = (otherStatus.content as Array<{ text: string }>)[0]!.text;
    const otherStatusPayload = JSON.parse(otherStatusText) as { error: { code: string; recovery_id?: string; diagnostic?: { http_status_observed?: string } } };
    assert.equal(otherStatusPayload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(otherStatusPayload.error.diagnostic?.http_status_observed, undefined,
      "a 500 on the exact generation route must remain generic and untagged");
    assert.doesNotMatch(otherStatusText, /SYNTHETIC_DETAIL_MUST_NEVER_ESCAPE|must-not-be-read|HTTP_422_OBSERVED/u);
    assert.equal(generationPosts, 2);
    const otherReplay = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[2]!, arguments: { ...input,
      prompt: "Make the motion calmer." } });
    assert.equal(otherReplay.isError, true); assert.equal(generationPosts, 2, "the 500 intent is also sticky and never replayed");

    history422 = true;
    const otherGet422 = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[3]!, arguments: { link_attempt_id: ATTEMPT,
      recovery_id: otherStatusPayload.error.recovery_id } });
    assert.equal(otherGet422.isError, true);
    const otherGet422Text = (otherGet422.content as Array<{ text: string }>)[0]!.text;
    const otherGet422Payload = JSON.parse(otherGet422Text) as { error: { code: string; diagnostic?: { http_status_observed?: string } } };
    assert.equal(otherGet422Payload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(otherGet422Payload.error.diagnostic?.http_status_observed, undefined,
      "a 422 history GET must not receive the generation POST marker");
    assert.doesNotMatch(otherGet422Text, /SYNTHETIC_DETAIL_MUST_NEVER_ESCAPE|must-not-be-read|HTTP_422_OBSERVED/u);
    history422 = false;
    const recoveryId = generationPayload.error.recovery_id!;
    const reconciled = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[3]!, arguments: { link_attempt_id: ATTEMPT, recovery_id: recoveryId } });
    assert.equal(reconciled.isError, true);
    assert.equal(historyGets, 2, "reconciliations use history GET only after their one POST");
    const reconcileText = (reconciled.content as Array<{ text: string }>)[0]!.text;
    const reconcilePayload = JSON.parse(reconcileText) as { error: { code: string; diagnostic?: { http_status_observed?: string } } };
    assert.equal(reconcilePayload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(reconcilePayload.error.diagnostic?.http_status_observed, "HTTP_422_OBSERVED");

    const listed = await client.callTool({ name: OWNER_TOPAZ_ASTRA_TOOL_NAMES[4]!, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const recoveries = (listed.structuredContent as { recoveries: Array<{ diagnostic: { http_status_observed?: string } }> }).recoveries;
    assert.equal(recoveries[0]?.diagnostic.http_status_observed, "HTTP_422_OBSERVED");
    assert.equal(recoveries[1]?.diagnostic.http_status_observed, undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cancelledBodies, 4, "all non-OK upload, generation and history bodies were cancelled without being read");
  } finally {
    await Promise.allSettled([client.close(), server.close(), generation.close(), original.close(), store.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});
