import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerTopazAstraExistingMediaService } from "../src/application/owner-topaz-astra-existing-media-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES, registerSyntxOwnerTopazAstraExistingMediaTools } from "../src/mcp/owner-topaz-astra-existing-media-tools.js";

test("1526 official SDK exposes only bounded GET-only Topaz existing-result reads", async () => {
  const attempt = "link_topaz_existing_1526_owner_0123456789", binding = { tenant_id: "topaz-1526", subject: "owner-1526" }, url = "https://r2.syntx.ai/private/result.mp4";
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE, async createChallenge() { return { upstream_attempt_id: "1526", approval_url: "https://example.invalid" }; }, async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-topaz-1526-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(), links = new PerUserLinkService(provider, store, { attemptIdGenerator: () => attempt });
  await links.createAttempt(binding); await links.issueHandoff(binding, attempt); await links.checkAttempt(binding, attempt);
  const broker: SyntxCredentialBroker = { useCredential: <T>(operation: (credential: string) => Promise<T>) => links.useCredential(binding, attempt, (credential) => operation(credential.value)) };
  const paths: string[] = [], fetchImpl: typeof fetch = async (input, init) => { const path = new URL(input instanceof Request ? input.url : String(input)).pathname; paths.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/v1/chats") return Response.json({ chats: [
      { id: 1, uuid: "chat-1526", scope: "tool_video_upscaler", title: "owner-topaz-astra-12345678-1234-4abc-8def-123456789abc" },
      { id: 2, uuid: "ordinary-chat-1526", scope: "tool_video_upscaler", title: "unowned-result" }
    ], pagination: { page: 1, page_size: 20, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    const message = { id: "bot", chat_id: 1, author_id: -1, message_object: [{ id: "obj", message_id: "bot", object_type: "video", object_url: url, model_type: "slp-2.5", completed: true }] };
    return Response.json(path.endsWith("/messages") ? { messages: [{ id: "ack", chat_id: 1, author_id: 17, message_object: [] }, message], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } } : message); };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const service = new OwnerTopazAstraExistingMediaService({ binding, genuinePerUserLinkService: links, resolveChatClient: () => chatClient });
  const server = new McpServer({ name: "topaz-existing-1526", version: "1.0.0" }), client = new Client({ name: "topaz-existing-sdk-1526", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    registerSyntxOwnerTopazAstraExistingMediaTools(server, service); await server.connect(st); await client.connect(ct);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES);
    const listed = await client.callTool({ name: OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES[0], arguments: { link_attempt_id: attempt, page: 1 } });
    assert.equal(listed.isError, undefined, `${JSON.stringify(listed)} paths=${JSON.stringify(paths)}`);
    const resultHandle = (listed.structuredContent as { results: Array<{ result_handle: string }> }).results[0]!.result_handle;
    assert.equal((listed.structuredContent as { results: unknown[] }).results.length, 1);
    assert.equal(JSON.stringify(listed.structuredContent).includes("ordinary-chat-1526"), false);
    const got = await client.callTool({ name: OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES[1], arguments: { link_attempt_id: attempt, result_handle: resultHandle } });
    assert.equal((got.structuredContent as { object_url: string }).object_url, url); assert.ok(paths.every((path) => path.startsWith("GET ")));
    assert.equal((await client.callTool({ name: OWNER_TOPAZ_ASTRA_EXISTING_MEDIA_TOOL_NAMES[0], arguments: { link_attempt_id: attempt, user_id: "forged" } })).isError, true);
  } finally { await Promise.allSettled([client.close(), server.close(), service.close(), store.close()]); }
});
