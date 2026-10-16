import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
import { OwnerGrokV2vGenerationService } from "../src/application/owner-grok-v2v-generation-service.js";
import { OwnerGrokV2vOriginalReferenceService } from "../src/application/owner-grok-v2v-original-reference-service.js";
import { createOwnerGrokV2vOwnedRequestPreparer } from "../src/application/owner-grok-v2v-owned-request-preparer.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  OWNER_GROK_V2V_TOOL_NAMES,
  SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME,
  SYNTX_OWNER_GET_GROK_V2V_RESULT_PAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_V2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME,
  registerSyntxOwnerGrokV2vTools
} from "../src/mcp/owner-grok-v2v-tools.js";

const ATTEMPT = "link_grok_v2v_tools_2065_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "grok-v2v-tools-tenant", subject: "grok-v2v-tools-owner" });
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, join(process.cwd(), "catalog")));
const PROMPT = "Use the uploaded source as context for a video response.";
const CHAT = "grok-v2v-tools-chat";
const ACK = "grok-v2v-tools-ack";
const RESULT_MESSAGE = "grok-v2v-tools-result";
const SOURCE_URL = "https://r2.syntx.ai/grok-v2v/hidden/original.mp4";
const RESULT_URLS = [
  "https://r2.syntx.ai/grok-v2v/results/first.mp4",
  "https://r2.syntx.ai/grok-v2v/results/second.mp4"
] as const;
const SOURCE = (() => {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
})();
const VIDEO_PROBE = {
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 672, height: 610, duration: "3.14159", disposition: { attached_pic: 0 } },
    { index: 1, codec_type: "audio", codec_name: "aac", duration: "3.1" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.14159" }
};

function response(value: unknown, status = 200): Response { return Response.json(value, { status }); }
function errorObject(result: unknown): Record<string, unknown> {
  const content = (result as { readonly content?: readonly { readonly type: string; readonly text?: string }[] })?.content;
  const text = content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text!) as Record<string, unknown>;
}

interface Harness {
  readonly server: McpServer;
  readonly client: Client;
  readonly referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly generationService: OwnerGrokV2vGenerationService;
  readonly calls: { upload: number; chat: number; generate: number; history: number; result: number; quote: number };
  readonly directory: string;
  close(): Promise<void>;
}

async function createHarness(options: { failFirstHistory?: boolean; pendingHistoryReads?: number; prompt?: string } = {}): Promise<Harness> {
  let now = 1_000_000;
  const clock = () => now;
  const prompt = options.prompt ?? PROMPT;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-grok-v2v-tools-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-grok-v2v-tools-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(clock), {
    now: clock, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  const created = await links.createAttempt(BINDING);
  assert.equal(created.attempt_id, ATTEMPT);
  await links.issueHandoff(BINDING, ATTEMPT);
  await links.checkAttempt(BINDING, ATTEMPT);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, value => operation(value.value));
  } };
  const calls = { upload: 0, chat: 0, generate: 0, history: 0, result: 0, quote: 0 };
  const rows = () => [
    { id: ACK, chat_id: 88103, author_id: 17, message_object: [
      { id: "grok-v2v-tools-prompt", message_id: ACK, object_type: "text", object_text: prompt },
      { id: "grok-v2v-tools-input", message_id: ACK, object_type: "video", object_url: SOURCE_URL, model_type: "grok_v2v" }
    ] },
    { id: RESULT_MESSAGE, chat_id: 88103, author_id: -1, message_object: RESULT_URLS.map((object_url, index) => ({
      id: `grok-v2v-tools-object-${index + 1}`, message_id: RESULT_MESSAGE, object_type: "video", object_url,
      completed: true, model_type: "grok_v2v"
    })) }
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") return response({ balance: "1.00" });
    if (url.pathname === "/api/v1/user/subscription") return response({ active: false, type: null, end_date: null });
    if (url.pathname === "/api/v2/get_model_info") {
      calls.quote++;
      assert.equal(url.searchParams.get("ai_name"), "grok_video");
      assert.equal(url.searchParams.get("model_type"), "grok_v2v");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "720p");
      assert.equal(url.searchParams.get("video_duration"), "3.14");
      return response({ access: true, cost: 0.25, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      calls.upload++;
      const form = init.body as FormData, file = form.get("files");
      assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("model_type"), "grok_v2v");
      assert.equal(form.get("destination"), "hidden");
      assert.equal(form.get("check_duplicates"), "true");
      assert.ok(file instanceof File);
      assert.equal(file.name, "original.mp4");
      assert.equal(file.type, "video/mp4");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), SOURCE);
      return response({ files: [{ filename: file.name, url: SOURCE_URL, status: "success", size: SOURCE.byteLength, content_type: "video/mp4" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      calls.chat++;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]);
      assert.equal(body.scope, "video");
      return response({ uuid: CHAT });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      calls.generate++;
      assert.equal(url.search, "?ai_name=grok_video");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
      assert.equal(body.chat_id, CHAT);
      assert.equal(body.prompt, prompt);
      assert.deepEqual(body.settings, { model_type: "grok_v2v", aspect_ratio: null, video_duration: 3.14,
        resolution: "720p", file_urls: [{ type: "video", url: SOURCE_URL }] });
      return response({ id: ACK });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/messages` && method === "GET") {
      calls.history++;
      if (options.failFirstHistory && calls.history === 1) return response({ error: "synthetic temporary history error" }, 503);
      const messages = options.pendingHistoryReads !== undefined && calls.history <= options.pendingHistoryReads ? [rows()[0]] : rows();
      return response({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${RESULT_MESSAGE}` && method === "GET") {
      calls.result++;
      return response(rows()[1]);
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-tools-2065-"));
  const ffprobePath = join(directory, "ffprobe-fixture");
  const ffprobeScript = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);` +
    `const path=args.at(-1);if(!path||!fs.statSync(path).isFile())process.exit(40);` +
    `const i=args.indexOf("-protocol_whitelist"),e=args.indexOf("-show_entries");` +
    `if(i<0||args[i+1]!=="file"||e<0||!args[e+1].includes("stream_disposition=attached_pic"))process.exit(41);` +
    `process.stdout.write(${JSON.stringify(JSON.stringify(VIDEO_PROBE))});\n`;
  await writeFile(ffprobePath, ffprobeScript, { mode: 0o700, flag: "wx" });
  await chmod(ffprobePath, 0o700);
  const referenceService = new OwnerGrokV2vOriginalReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffprobePath: await realpath(ffprobePath), destination: "hidden", now: clock });
  const preparer = createOwnerGrokV2vOwnedRequestPreparer({ referenceService, now: clock });
  const generationService = new OwnerGrokV2vGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, referenceService, resolveChatClient: () => client, now: clock,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), clock),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), clock) });
  const server = new McpServer({ name: "grok-v2v-tools-2065", version: "1.0.0" });
  const clientSdk = new Client({ name: "grok-v2v-tools-sdk-2065", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerSyntxOwnerGrokV2vTools(server, { referenceService, generationService });
  await server.connect(serverTransport);
  await clientSdk.connect(clientTransport);
  return {
    server, client: clientSdk, referenceService, generationService, calls, directory,
    async close() {
      await Promise.allSettled([clientSdk.close(), server.close(), generationService.close(), referenceService.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test("Grok V2V tools expose exact six SDK names, static source report and strict no-dispatch validation", async () => {
  const harness = await createHarness();
  try {
    const listed = await harness.client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), OWNER_GROK_V2V_TOOL_NAMES);
    const sourceTool = listed.tools.find(tool => tool.name === SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME);
    const uploadTool = listed.tools.find(tool => tool.name === SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME);
    const generateTool = listed.tools.find(tool => tool.name === SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME);
    assert.deepEqual(Object.keys((generateTool?.inputSchema as { properties: Record<string, unknown> }).properties).sort(),
      ["grok_reference_handle", "link_attempt_id", "model_id", "prompt"]);
    assert.equal((generateTool?.inputSchema as { additionalProperties?: unknown }).additionalProperties, false);
    assert.equal(sourceTool?.annotations?.readOnlyHint, true);
    assert.equal(uploadTool?.annotations?.idempotentHint, false);
    assert.equal(generateTool?.annotations?.idempotentHint, false);
    const staticReport = await harness.client.callTool({ name: SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME, arguments: { model_id: "grok_v2v" } });
    assert.equal(staticReport.isError, undefined);
    const staticContent = staticReport.structuredContent as { model_id: string; runtime_usable: boolean; dispatch_allowed: boolean; profile: { effective_defaults: string } };
    assert.equal(staticContent.model_id, "grok_v2v");
    assert.equal(staticContent.runtime_usable, false);
    assert.equal(staticContent.dispatch_allowed, false);
    assert.equal(staticContent.profile.effective_defaults, "UNKNOWN");
    assert.deepEqual(harness.calls, { upload: 0, chat: 0, generate: 0, history: 0, result: 0, quote: 0 });

    const uploadInvalid = await harness.client.callTool({ name: SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", filename: "original.mp4", mime_type: "video/mp4",
      content_base64: SOURCE.toString(), url: SOURCE_URL
    } });
    assert.equal(uploadInvalid.isError, true);
    const nonCanonicalBase64 = await harness.client.callTool({ name: SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", filename: "original.mp4", mime_type: "video/mp4",
      content_base64: `${Buffer.from(SOURCE).toString("base64")}=`
    } });
    assert.equal(nonCanonicalBase64.isError, true);
    const generateInvalid = await harness.client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: "grok_v2v_reference_00000000-0000-0000-0000-000000000000",
      resolution: "720p"
    } });
    assert.equal(generateInvalid.isError, true);
    const blankPrompt = await harness.client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", prompt: "  ", grok_reference_handle: "grok_v2v_reference_00000000-0000-0000-0000-000000000000"
    } });
    assert.equal(blankPrompt.isError, true);
    const longPrompt = await harness.client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", prompt: "x".repeat(2_001), grok_reference_handle: "grok_v2v_reference_00000000-0000-0000-0000-000000000000"
    } });
    assert.equal(longPrompt.isError, true);
    assert.equal(harness.calls.upload, 0);
    assert.equal(harness.calls.chat, 0);
    assert.equal(harness.calls.generate, 0);
  } finally { await harness.close(); }
});

test("Grok V2V MCP uploads once, returns opaque receipt, recovers unknown outcome GET-only and pages safe results", async () => {
  const harness = await createHarness({ failFirstHistory: true });
  try {
    const encoded = Buffer.from(SOURCE).toString("base64");
    const upload = await harness.client.callTool({ name: SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", filename: "original.mp4", mime_type: "video/mp4", content_base64: encoded
    } });
    assert.equal(upload.isError, undefined, JSON.stringify(upload));
    const receipt = upload.structuredContent as { grok_reference_handle: string; size: number; mime_type: string; sha256: string };
    assert.match(receipt.grok_reference_handle, /^grok_v2v_reference_[0-9a-f-]{36}$/u);
    assert.equal(receipt.size, SOURCE.byteLength);
    assert.equal(receipt.mime_type, "video/mp4");
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(upload.structuredContent).includes("https://r2.syntx.ai"), false);

    const generated = await harness.client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: receipt.grok_reference_handle
    } });
    assert.equal(generated.isError, true);
    const generatedError = errorObject(generated) as { error?: { code?: string; recovery_id?: string } };
    assert.equal(generatedError.error?.code, "OUTCOME_UNKNOWN");
    assert.match(generatedError.error?.recovery_id ?? "", /^grok_v2v_recovery_[0-9a-f-]{36}$/u);
    assert.equal(harness.calls.generate, 1);

    const recoveryId = generatedError.error!.recovery_id!;
    const listed = await harness.client.callTool({ name: SYNTX_OWNER_LIST_GROK_V2V_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, limit: 5
    } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.equal((listed.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
    assert.equal(JSON.stringify(listed.structuredContent).includes("https://r2.syntx.ai"), false);

    const reconciled = await harness.client.callTool({ name: SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recoveryId
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    const result = reconciled.structuredContent as { status: string; artifacts: Array<{ object_url: string; model_id: string }>; backend_acceptance: string };
    assert.equal(result.status, "completed");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.deepEqual(result.artifacts.map(value => value.object_url), RESULT_URLS);
    assert.ok(result.artifacts.every(value => value.model_id === "grok_v2v"));

    const page = await harness.client.callTool({ name: SYNTX_OWNER_GET_GROK_V2V_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recoveryId, offset: 1
    } });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    assert.equal((page.structuredContent as { artifacts: unknown[] }).artifacts.length, 1);
    assert.equal(harness.calls.upload, 1);
    assert.equal(harness.calls.generate, 1, "reconciliation and paging must never repeat generation");
    assert.equal(harness.calls.history, 2);
    assert.equal(harness.calls.result, 1);
    assert.equal(harness.calls.quote, 2);
  } finally { await harness.close(); }
});

test("Grok V2V composition rejects plain and proxy services before registration", async () => {
  const server = new McpServer({ name: "grok-v2v-tools-invalid-2065", version: "1.0.0" });
  try {
    assert.throws(() => registerSyntxOwnerGrokV2vTools(server, { referenceService: {}, generationService: {} }),
      /INVALID_GROK_V2V_SERVICE_COMPOSITION/u);
    assert.throws(() => registerSyntxOwnerGrokV2vTools(server, { referenceService: new Proxy({}, {}), generationService: {} }),
      /INVALID_GROK_V2V_SERVICE_COMPOSITION/u);
  } finally { await server.close(); }
});

test("Grok V2V returns result pages after cumulative pending history GET counters exceed 255", async () => {
  const prompt = `${PROMPT} long-poll-2069`;
  const harness = await createHarness({ pendingHistoryReads: 256, prompt });
  try {
    const encoded = Buffer.from(SOURCE).toString("base64");
    const upload = await harness.client.callTool({ name: SYNTX_OWNER_UPLOAD_GROK_V2V_REFERENCE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", filename: "original.mp4", mime_type: "video/mp4", content_base64: encoded
    } });
    assert.equal(upload.isError, undefined, JSON.stringify(upload));
    const handle = (upload.structuredContent as { grok_reference_handle: string }).grok_reference_handle;
    const generation = await harness.client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_v2v", prompt, grok_reference_handle: handle
    } });
    assert.equal(generation.isError, true);
    const unknown = errorObject(generation) as { error?: { code?: string; recovery_id?: string } };
    assert.equal(unknown.error?.code, "OUTCOME_UNKNOWN");
    const recoveryId = unknown.error?.recovery_id;
    assert.match(recoveryId ?? "", /^grok_v2v_recovery_[0-9a-f-]{36}$/u);

    for (let index = 0; index < 255; index += 1) {
      const pending = await harness.client.callTool({ name: SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, recovery_id: recoveryId
      } });
      assert.equal(pending.isError, true);
      assert.equal((errorObject(pending) as { error?: { code?: string } }).error?.code, "OUTCOME_UNKNOWN");
    }
    assert.equal(harness.calls.history, 256);
    const completed = await harness.client.callTool({ name: SYNTX_OWNER_RECONCILE_GROK_V2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recoveryId
    } });
    assert.equal(completed.isError, undefined, JSON.stringify(completed));
    const result = completed.structuredContent as { diagnostic: { history_get_calls: number; result_get_calls: number }; artifacts: unknown[] };
    assert.equal(result.diagnostic.history_get_calls, 257);
    assert.equal(result.diagnostic.result_get_calls, 1);
    assert.equal(result.artifacts.length, 2);
    const listed = await harness.client.callTool({ name: SYNTX_OWNER_LIST_GROK_V2V_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT
    } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.equal((listed.structuredContent as { recoveries: Array<{ diagnostic: { history_get_calls: number } }> })
      .recoveries[0]?.diagnostic.history_get_calls, 257);
    const page = await harness.client.callTool({ name: SYNTX_OWNER_GET_GROK_V2V_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recoveryId, offset: 1
    } });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    assert.equal((page.structuredContent as { artifacts: unknown[] }).artifacts.length, 1);
    assert.equal(harness.calls.generate, 1, "long polling and paging never repeat the generation POST");
    assert.equal(harness.calls.history, 257);
    assert.equal(harness.calls.result, 1);
  } finally { await harness.close(); }
});
