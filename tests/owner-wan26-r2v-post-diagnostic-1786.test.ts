import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerWan26R2vNativeError } from "../src/adapter/syntx/owner-wan26-r2v-native-context.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWan26R2vGenerationService, OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION,
  type OwnerWan26R2vGenerationDiagnostic } from "../src/application/owner-wan26-r2v-generation-service.js";
import { OwnerWan26R2vReferenceService } from "../src/application/owner-wan26-r2v-reference-service.js";
import { createOwnerWan26R2vRequestPreparer } from "../src/application/owner-wan26-r2v-request-preparer.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_WAN26_R2V_TOOL_NAMES, registerSyntxOwnerWan26R2vTools } from "../src/mcp/owner-wan26-r2v-tools.js";

const ATTEMPT = "link_wan26_post_diag_1786_012345";
const BINDING = Object.freeze({ tenant_id: "wan26-r2v-post-diag-1786", subject: "owner" });
const NOW = Date.parse("2026-10-16T10:00:00.000Z");
const SECRET_MARKER = "PRIVATE_HTTP_BODY_MARKER_1786";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(use: (credential: string) => Promise<T>) { return use("synthetic-r2v-1786-credential"); } };
}
function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20); let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29); return bytes;
}
async function withClient<T>(server: McpServer, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "owner-wan26-r2v-post-diagnostic-1786", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); return await run(client); }
  finally { await client.close(); await server.close(); }
}
function dataOf(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  const structured = (result as Record<string, unknown>).structuredContent;
  return structured && typeof structured === "object" ? structured as Record<string, unknown> : {};
}

test("native start error class defaults to null and accepts only canonical codes", () => {
  assert.equal(new OwnerWan26R2vNativeError("OUTCOME_UNKNOWN").start_error_class, null);
  assert.equal(new OwnerWan26R2vNativeError("OUTCOME_UNKNOWN", SECRET_MARKER).start_error_class, null);
  assert.equal(new OwnerWan26R2vNativeError("OUTCOME_UNKNOWN", "UPSTREAM_PROTOCOL_ERROR").start_error_class,
    "UPSTREAM_PROTOCOL_ERROR");
  const legacyDiagnostic: OwnerWan26R2vGenerationDiagnostic = { post_started: false, ack_known: false,
    history_status: "NOT_READ", owner_ack_status: "NOT_READ", history_get_calls: 0, result_get_calls: 0,
    backend_error_observed: false, pending_object_indices: [], gaps: [] };
  assert.equal(legacyDiagnostic.start_error_class ?? null, null);
});

for (const scenario of [
  { name: "HTTP 429", mode: "http_429" as const, errorClass: "UPSTREAM_RATE_LIMITED" },
  { name: "HTTP 200 ACK JSON without id", mode: "ack_missing_id" as const, errorClass: "UPSTREAM_PROTOCOL_ERROR" }
]) {
  test(`WAN26 R2V ${scenario.name} remains unknown while exposing only its safe HTTP-client class`, async () => {
    const state = { now: NOW, posts: 0, histories: 0, results: 0, chats: 0,
      chat: "", providerChat: 718_786, prompt: "synthetic post diagnostic", ack: "owner-ack-1786",
      result: "bot-result-1786", object: "video-object-1786" };
    const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
      async createChallenge() { return { upstream_attempt_id: "r2v-post-diagnostic-1786", approval_url: "https://example.invalid/approval" }; },
      async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-link-token" }); return { state: "LINKED" }; } };
    const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => state.now), {
      now: () => state.now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
    });
    await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);

    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init.method ?? (input instanceof Request ? input.method : "GET");
      if (method === "GET" && url.pathname.endsWith("/user/balance")) return response({ balance: "900" });
      if (method === "GET" && url.pathname.endsWith("/user/subscription")) {
        return response({ active: true, type: "PRO", end_date: new Date(state.now + 3_600_000).toISOString() });
      }
      if (method === "GET" && url.pathname.endsWith("/get_model_info")) return response({ access: true, cost: 5,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
      if (method === "POST" && url.pathname.endsWith("/chats/upload-files")) {
        const file = (init.body as FormData).get("files"); assert.ok(file instanceof File);
        return response({ files: [{ id: "upload-1786", filename: file.name, url: `https://r2.syntx.ai/r2v/${file.name}`,
          mime_type: file.type, content_type: file.type, type: "image", media_type: "image", status: "uploaded", size: file.size }] });
      }
      if (method === "POST" && url.pathname.endsWith("/chats")) {
        state.chats += 1; state.chat = `post-diagnostic-chat-${state.chats}`; return response({ uuid: state.chat });
      }
      if (method === "POST" && url.pathname.endsWith("/video/generate")) {
        state.posts += 1; assert.equal(url.search, "?ai_name=wan_video");
        if (scenario.mode === "http_429") return new Response(SECRET_MARKER, { status: 429, headers: { "content-type": "text/plain" } });
        return response({ debug: SECRET_MARKER });
      }
      if (method === "GET" && url.pathname.endsWith("/messages")) {
        state.histories += 1;
        const messages = [
          { id: state.ack, chat_id: state.providerChat, author_id: 27, message_object: [{ id: "owner-text-1786",
            message_id: state.ack, object_type: "text", model_type: "wan_26_r2v", object_text: state.prompt }] },
          { id: state.result, chat_id: state.providerChat, author_id: -1, message_object: [{ id: state.object,
            message_id: state.result, object_type: "video", model_type: "wan_26_r2v", completed: true }] }
        ];
        return response({ messages, pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1,
          has_next: false, has_previous: false } });
      }
      if (method === "GET" && url.pathname.includes("/chats/") && !url.pathname.endsWith("/messages")) {
        state.results += 1;
        return response({ id: state.result, chat_id: state.providerChat, author_id: -1, message_object: [{ id: state.object,
          message_id: state.result, object_type: "video", model_type: "wan_26_r2v", completed: true,
          object_url: "https://r2.syntx.ai/r2v/results/post-diagnostic-1786.mp4" }] });
      }
      throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
    };
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl, requestTimeoutMs: 5_000 });
    const references = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
      ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe", now: () => state.now });
    const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService: references,
      now: () => state.now });
    const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION,
      join(process.cwd(), "catalog")));
    const generation = new OwnerWan26R2vGenerationService({ binding: BINDING, linkService: links, catalog,
      catalog_version: OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION, preparer, referenceService: references,
      resolveChatClient: () => client,
      createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker(), fetchImpl }), () => state.now),
      createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: broker(), fetchImpl }), () => state.now),
      now: () => state.now, timeoutMs: 15_000 });
    const server = new McpServer({ name: "syntx-r2v-post-diagnostic-1786", version: "1.0.0" });
    try {
      registerSyntxOwnerWan26R2vTools(server, { referenceService: references, generationService: generation });
      await withClient(server, async (mcp) => {
        const uploaded = await mcp.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
          model_id: "wan_26_r2v", filename: "post-diagnostic.png", mime_type: "image/png", content_base64: png384().toString("base64") } });
        assert.equal(uploaded.isError, undefined);
        const referenceHandle = String(dataOf(uploaded).reference_handle);
        const generated = await mcp.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT,
          model_id: "wan_26_r2v", prompt: state.prompt, resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
          seed: null, reference_handles: [referenceHandle] } });
        assert.equal(generated.isError, true);
        const failure = dataOf(generated);
        assert.equal(failure.error_code, "OUTCOME_UNKNOWN");
        assert.equal(state.posts, 1, "the paid generation endpoint is invoked once");
        const recoveryId = String(failure.recovery_id);
        const diagnostic = failure.diagnostic as Record<string, unknown>;
        assert.equal(diagnostic.start_error_class, scenario.errorClass);
        assert.equal(diagnostic.post_started, true); assert.equal(diagnostic.ack_known, false);
        assert.equal(diagnostic.history_status, "NOT_READ"); assert.equal(diagnostic.owner_ack_status, "NOT_READ");
        assert.equal(JSON.stringify(failure).includes(SECRET_MARKER), false, "raw HTTP body markers are not surfaced");

        const recovered = await mcp.callTool({ name: OWNER_WAN26_R2V_TOOL_NAMES[5], arguments: { link_attempt_id: ATTEMPT,
          recovery_id: recoveryId } });
        assert.equal(recovered.isError, undefined);
        const result = dataOf(recovered), resultDiagnostic = result.diagnostic as Record<string, unknown>;
        assert.equal(result.status, "completed");
        assert.equal(result.source_readiness, "PARTIAL_SOURCE_EXPLICIT_SETTINGS");
        assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.provider_terminal_status, "UNPROVEN");
        assert.equal(resultDiagnostic.start_error_class, scenario.errorClass, "GET observation retains the POST error class");
        assert.equal(resultDiagnostic.post_started, true); assert.equal(resultDiagnostic.ack_known, true);
        assert.equal(resultDiagnostic.history_status, "COMPLETE"); assert.equal(resultDiagnostic.owner_ack_status, "MATCHED");
        assert.equal(state.posts, 1, "history and result recovery perform no second POST");
        assert.equal(state.histories, 1); assert.equal(state.results, 1);
        assert.equal(JSON.stringify(result).includes(SECRET_MARKER), false);
      });
    } finally { await generation.close(); await references.close(); }
  });
}
