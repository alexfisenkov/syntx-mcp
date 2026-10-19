import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { OwnerReviewedNoReferenceT2vServiceError, OwnerSeedance25T2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerSeedance25T2vProfile } from "../src/application/owner-seedance25-t2v-profile.js";
import { OWNER_SEEDANCE25_T2V_TOOL_NAMES, registerSyntxOwnerSeedance25T2vTools } from "../src/mcp/owner-seedance25-t2v-tools.js";

const ATTEMPT_ID = "link_seedance25_t2v2348_owner_0123456789abcdef";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "seedance25-t2v2348", subject: "source-bound-owner" });
const OUTPUT_URL = "https://r2.syntx.ai/seedance25-t2v2348/result.mp4";
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

async function fixture() {
  let now = Date.parse("2026-10-19T15:00:00.000Z"), chatCount = 0, postCount = 0, uploadCount = 0;
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "seedance25-t2v2348", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-seedance25-t2v2348" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT_ID });
  await links.createAttempt(AUTH_BINDING); await links.issueHandoff(AUTH_BINDING, ATTEMPT_ID); await links.checkAttempt(AUTH_BINDING, ATTEMPT_ID);
  const requests: Array<{ url: URL; method: string; body: unknown }> = [];
  const accessParameters: Array<Readonly<Record<string, unknown>>> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chatCount++; return json({ uuid: `seedance25-chat-${chatCount}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { postCount++; return json({ id: `seedance25-echo-${postCount}` }); }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/inprogress" && method === "GET") {
      return json([{ message_id: "seedance25-bot-1", object_type: "video", model_type: "seedance-2.5" }]);
    }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/messages" && method === "GET") {
      const messages = [
        { id: "seedance25-echo-1", chat_id: 725, author_id: 21_234, message_object: [] },
        { id: "seedance25-bot-1", chat_id: 725, author_id: -1, message_object: [{ id: "seedance25-video-1", message_id: "seedance25-bot-1",
          object_type: "video", model_type: "seedance-2.5", completed: true, object_url: OUTPUT_URL }] }
      ];
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/seedance25-echo-1" && method === "GET") {
      return json({ id: "seedance25-echo-1", chat_id: 725, author_id: 21_234, message_object: [] });
    }
    if (url.pathname === "/api/v1/chats/seedance25-chat-1/seedance25-bot-1" && method === "GET") {
      return json({ id: "seedance25-bot-1", chat_id: 725, author_id: -1, message_object: [{ id: "seedance25-video-1",
        message_id: "seedance25-bot-1", object_type: "video", model_type: "seedance-2.5", completed: true, object_url: OUTPUT_URL }] });
    }
    if (url.pathname.includes("upload-files")) { uploadCount++; throw new Error("no-media T2V must not upload"); }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerSeedance25T2vProfile(resolve(process.cwd(), "catalog"));
  const service = new OwnerSeedance25T2vGenerationService({ profile, binding: AUTH_BINDING, linkService: links,
    resolveSubscription: async (): Promise<SyntxSubscription> => { now += 1_000; return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null }; },
    resolveModelAccess: async (_attempt, modelId, costParameters): Promise<ModelAccessResult> => {
      now += 1_000; accessParameters.push(Object.freeze({ ...costParameters }));
      return { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: "seedance-2.5", ai_name: "seedance", model_type: modelId, account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString() };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-seedance25-t2v2348");
    } }, fetchImpl, requestTimeoutMs: 1_000 }), now: () => now, wait: async () => undefined, videoTimeoutMs: 20
  });
  return { profile, service, requests, accessParameters, counts: () => ({ chatCount, postCount, uploadCount }), close: () => service.close() };
}

test("Seedance 2.5 in-memory MCP flow performs one no-upload GEN then GET-only result reads", async () => {
  const state = await fixture(), server = new McpServer({ name: "seedance25-t2v2348", version: "1" });
  registerSyntxOwnerSeedance25T2vTools(server, { service: state.service });
  const client = new Client({ name: "seedance25-t2v2348-client", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), OWNER_SEEDANCE25_T2V_TOOL_NAMES);
    const source = await client.callTool({ name: OWNER_SEEDANCE25_T2V_TOOL_NAMES[0], arguments: {} });
    assert.equal(source.isError, undefined);
    const sourceProfile = source.structuredContent as { controls: { mode: { value: string } };
      form_validation: { initializer_mode_disposition: string; no_media_candidate_validation: string;
        mode_change_evidence: { form_mode_helper_offset: number[]; form_model_watcher_offset: number[];
          seedance25_mode_assignment_offset: number[]; helper_mode_literal: string } };
      cost_projection: { candidate_values: { mode: string } } };
    assert.equal(sourceProfile.controls.mode.value, "omni-references");
    assert.equal(sourceProfile.form_validation.initializer_mode_disposition, "MINI_REJECTED_FOR_QUOTE400_MODEL_SWITCH_CANDIDATE");
    assert.equal(sourceProfile.form_validation.no_media_candidate_validation, "UNCONFIRMED_FOR_OMNI_REFERENCES");
    assert.deepEqual(sourceProfile.form_validation.mode_change_evidence, {
      form_helper_imports: "S as w, M as B, o as q", form_mode_helper_offset: [4295, 4341],
      form_model_watcher_offset: [5328, 6937], seedance25_mode_assignment_offset: [6694, 6711],
      helper_export_aliases: "S as Ka, M as zt, o as ja", helper_model_literal: "seedance-2.5",
      helper_mode_literal: "omni-references", helper_compare_model_literal: "seedance-2.0", helper_compare_mode_literal: "mini"
    });
    assert.equal(sourceProfile.cost_projection.candidate_values.mode, "omni-references");
    const generated = await client.callTool({ name: OWNER_SEEDANCE25_T2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT_ID, prompt: "A quiet cinematic transition.", resolution: "720p", aspect_ratio: "16:9",
      video_duration: 5, generate_audio: true
    } });
    assert.equal(generated.isError, undefined, JSON.stringify({ result: generated, requests: state.requests }));
    assert.equal((generated.structuredContent as { model_id: string }).model_id, "seedance-2.5");
    assert.equal((generated.structuredContent as { confidence_scope: string }).confidence_scope, "exact_result_only");
    assert.deepEqual(state.counts(), { chatCount: 1, postCount: 1, uploadCount: 0 });
    assert.deepEqual(state.accessParameters, [
      { video_duration: 5, duration: 0, mode: "omni-references", size: "16:9", resolution: "720p" },
      { video_duration: 5, duration: 0, mode: "omni-references", size: "16:9", resolution: "720p" }
    ]);
    const post = state.requests.find(request => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.ok(post); assert.equal(post.url.search, "?ai_name=seedance");
    assert.deepEqual(post.body, { chat_id: "seedance25-chat-1", prompt: "A quiet cinematic transition.", settings: {
      file_urls: [], model_type: "seedance-2.5", resolution: "720p", mode: "omni-references", aspect_ratio: "16:9", video_duration: 5, generate_audio: true
    } });
    assert.equal(state.requests.filter(request => request.method === "GET" && request.url.pathname === "/api/v1/chats/seedance25-chat-1/seedance25-bot-1").length, 1);
  } finally { await client.close(); await server.close(); await state.close(); }
});

test("Seedance 2.5 rejects caller aliases, extra wire fields and changed initial tuple before any HTTP call", async () => {
  const state = await fixture();
  try {
    for (const bad of [
      { model_id: "seedance-2.0" }, { mode: "fast" }, { resolution: "1080p" }, { aspect_ratio: "9:16" },
      { video_duration: 6 }, { generate_audio: false }, { file_urls: [{ type: "video", url: "https://r2.syntx.ai/x.mp4" }] },
      { camera_fixed: false }
    ]) {
      assert.throws(() => state.service.generate({ attemptId: ATTEMPT_ID, prompt: "Test prompt.", resolution: "720p",
        aspect_ratio: "16:9", video_duration: 5, generate_audio: true, ...bad } as never),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    }
    assert.equal(state.requests.length, 0);
  } finally { await state.close(); }
});

test("Seedance 2.5 OUTCOME_UNKNOWN exposes only a validated recovery id and never retries generation", async () => {
  const operations: string[] = [];
  let nextError: unknown = new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", "recovery_00000000-0000-4000-8000-000000000001");
  const service = {
    getParametersSource() { return {}; },
    async generate() { operations.push("generate"); throw nextError; },
    async reconcile() { operations.push("reconcile"); throw new Error("must not reconcile automatically"); },
    listRecoveries() { operations.push("listRecoveries"); return []; }
  };
  const server = new McpServer({ name: "seedance25-safe-error", version: "1" });
  registerSyntxOwnerSeedance25T2vTools(server, { service: service as never });
  const client = new Client({ name: "seedance25-safe-error-client", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const input = { link_attempt_id: ATTEMPT_ID, prompt: "A quiet cinematic transition.", resolution: "720p", aspect_ratio: "16:9", video_duration: 5, generate_audio: true };
    const unknown = await client.callTool({ name: OWNER_SEEDANCE25_T2V_TOOL_NAMES[1], arguments: input }) as CallToolResult;
    assert.equal(unknown.isError, true);
    const unknownPayload = JSON.parse(unknown.content[0]?.type === "text" ? unknown.content[0].text : "{}") as { error: Record<string, unknown> };
    assert.deepEqual(Object.keys(unknownPayload.error).sort(), ["code", "message", "recovery_id"]);
    assert.equal(unknownPayload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(unknownPayload.error.recovery_id, "recovery_00000000-0000-4000-8000-000000000001");
    assert.deepEqual(operations, ["generate"], "an uncertain dispatch must not trigger a retry or automatic recovery read");

    nextError = Object.assign(new Error("private provider detail"), { code: "OUTCOME_UNKNOWN", recovery_id: "recovery_00000000-0000-4000-8000-000000000001" });
    const generic = await client.callTool({ name: OWNER_SEEDANCE25_T2V_TOOL_NAMES[1], arguments: input }) as CallToolResult;
    assert.equal(generic.isError, true);
    const genericText = generic.content[0]?.type === "text" ? generic.content[0].text : "";
    assert.doesNotMatch(genericText, /private provider detail|recovery_00000000-0000-4000-8000-000000000001/u);
    const genericPayload = JSON.parse(genericText) as { error: Record<string, unknown> };
    assert.deepEqual(Object.keys(genericPayload.error).sort(), ["code", "message"]);
    assert.equal(genericPayload.error.code, "SEEDANCE25_T2V_UNAVAILABLE");
    assert.deepEqual(operations, ["generate", "generate"]);
  } finally { await client.close(); await server.close(); }
});
