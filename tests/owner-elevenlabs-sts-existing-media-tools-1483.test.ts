import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsStsExistingMediaService } from "../src/application/owner-elevenlabs-sts-existing-media-service.js";
import { registerSyntxOwnerElevenLabsStsExistingMediaTools,
  OWNER_ELEVENLABS_STS_EXISTING_MEDIA_TOOL_NAMES,
  SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME,
  SYNTX_OWNER_LIST_EXISTING_ELEVENLABS_STS_RESULTS_TOOL_NAME } from "../src/mcp/owner-elevenlabs-sts-existing-media-tools.js";

const ATTEMPT = "link_sts_existing_1483_owner_0123456789";
const FOREIGN_ATTEMPT = "link_sts_existing_1483_foreign_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-existing-1483-tenant", subject: "sts-existing-1483-owner" });
const CHAT_UUID = "12345678-1234-4abc-8def-123456789abc";
const CHAT_TITLE = "owner-elevenlabs-sts-12345678-1234-4abc-8def-123456789abc";
const OUTPUT_URL = "https://r2.syntx.ai/private/existing-sts-output.mp3";

test("1483 SDK registers two read-only tools, returns opaque list handles and revalidates exact result GET", async () => {
  let now = Date.parse("2026-10-15T00:00:00.000Z");
  const events: Array<[string, string]> = [];
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-existing-1483", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-existing-1483-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now);
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    events.push([method, url.pathname]);
    if (method !== "GET") throw new Error("Existing result reader must issue GET only.");
    if (url.pathname === "/api/v1/chats") return Response.json({ chats: [{ id: 8101, uuid: CHAT_UUID, scope: "audio", title: CHAT_TITLE }],
      pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages`) return Response.json({ messages: [
      { id: "owner-message", chat_id: 8101, author_id: 17, message_object: [
        { id: "owner-object", message_id: "owner-message", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] },
      { id: "bot-message", chat_id: 8101, author_id: -1, message_object: [
        { id: "bot-object", message_id: "bot-message", object_type: "audio", completed: true, model_type: "eleven_multilingual_sts_v2" }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/bot-message`) return Response.json({ id: "bot-message", chat_id: 8101, author_id: -1,
      message_object: [{ id: "bot-object", object_type: "audio", object_url: OUTPUT_URL, completed: true, model_type: "eleven_multilingual_sts_v2" }] });
    throw new Error("Unexpected local fixture route.");
  } });
  const service = new OwnerElevenLabsStsExistingMediaService({ binding: BINDING, linkService: links, resolveChatClient: () => client, now: () => now });
  const server = new McpServer({ name: "syntx-sts-existing-1483", version: "1.0.0" });
  registerSyntxOwnerElevenLabsStsExistingMediaTools(server, service);
  const mcpClient = new Client({ name: "sts-existing-sdk-1483", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await mcpClient.connect(clientTransport);
    const listedTools = (await mcpClient.listTools()).tools;
    assert.deepEqual(listedTools.map(({ name }) => name), OWNER_ELEVENLABS_STS_EXISTING_MEDIA_TOOL_NAMES);
    for (const tool of listedTools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
      assert.equal(tool.annotations?.openWorldHint, true);
    }
    const listed = await mcpClient.callTool({ name: SYNTX_OWNER_LIST_EXISTING_ELEVENLABS_STS_RESULTS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const projection = listed.structuredContent as { results: Array<{ result_handle: string; proof: Record<string, unknown> }> };
    assert.equal(projection.results.length, 1);
    const handle = projection.results[0]!.result_handle;
    assert.match(handle, /^existing_elevenlabs_sts_[0-9a-f-]{36}$/u);
    const renderedList = JSON.stringify(listed.structuredContent);
    for (const privateValue of [CHAT_TITLE, CHAT_UUID, OUTPUT_URL, "owner-message", "bot-message", "owner-object", "bot-object"])
      assert.equal(renderedList.includes(privateValue), false, `list must not expose ${privateValue}`);
    assert.deepEqual(projection.results[0]!.proof, { owner: "CURRENT_LINK_REVALIDATED",
      index: "CURRENT_OWNER_AUDIO_INDEX_AND_STS_TITLE", history: "COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_RESULT",
      model: "MATCHED_ELEVENLABS_STS_V2", result: "COMPLETED_EXACT_AUDIO_OBJECT", source_provenance: "NOT_AVAILABLE",
      provider_terminal_status: "UNPROVEN" });

    const extraField = await mcpClient.callTool({ name: SYNTX_OWNER_LIST_EXISTING_ELEVENLABS_STS_RESULTS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, message: "arbitrary chat text", page: 1 } });
    assert.equal(extraField.isError, true); assert.equal(events.length, 3);
    const arbitraryUrl = await mcpClient.callTool({ name: SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, result_handle: handle, object_url: "https://example.invalid/arbitrary.mp3" } });
    assert.equal(arbitraryUrl.isError, true); assert.equal(events.length, 3);

    const result = await mcpClient.callTool({ name: SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, result_handle: handle } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal((result.structuredContent as { object_url: string }).object_url, OUTPUT_URL);
    assert.equal(events.length, 4, "GET rereads the exact verified output object");
    const foreign = await mcpClient.callTool({ name: SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: FOREIGN_ATTEMPT, result_handle: handle } });
    assert.equal(foreign.isError, true); assert.equal(events.length, 4, "foreign owner attempt cannot reuse the handle");

    now += 15 * 60_000;
    const expired = await mcpClient.callTool({ name: SYNTX_OWNER_GET_EXISTING_ELEVENLABS_STS_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, result_handle: handle } });
    assert.equal(expired.isError, true); assert.equal(events.length, 4, "expired handle is rejected before upstream access");
  } finally {
    await Promise.allSettled([mcpClient.close(), server.close(), service.close()]);
    store.close();
  }
});
