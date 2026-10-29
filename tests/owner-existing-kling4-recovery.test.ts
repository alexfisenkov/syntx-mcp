import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerExistingVideoRecoveryService } from "../src/application/owner-existing-video-recovery-service.js";
import { OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME, registerOwnerExistingVideoResultTools } from "../src/mcp/owner-existing-video-recovery-tools.js";

const ATTEMPT = "link_kling4_recovery_test_owner_0123456789";
const PROMPT = "Synthetic Kling 4 no-reference recovery prompt.";
const OUTPUT_URL = "https://r2.syntx.ai/kling4-recovery-test/result.mp4";
const TARGETS = [
  { model_id: "kling_4_keyframes", chat_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner_message_id: "owner-kf-1", provider_message_id: "bot-kf-1", expected_prompt: PROMPT },
  { model_id: "kling_4_omni", chat_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", owner_message_id: "owner-omni-1", provider_message_id: "bot-omni-1", expected_prompt: PROMPT }
] as const;
type Model = typeof TARGETS[number]["model_id"];
type Mutation = "wrong_prefix" | "wrong_prompt" | "wrong_owner_model" | "owner_reference" | "owner_incomplete" |
  "bot_incomplete" | "detail_url_mismatch" | "detail_message_mismatch" | "unsafe_url";
const rows = new Map(TARGETS.map((target, index) => [target.model_id, { ...target,
  provider_chat_id: `chat-${index + 1}`, bot_kind: index === 1 ? "error" as const : "video" as const }]));
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

async function fixture(options: { readonly mutation?: Mutation; readonly mutationModel?: Model;
  readonly botKinds?: Partial<Record<Model, "video" | "error">> } = {}) {
  let now = Date.parse("2026-10-29T14:00:00.000Z"), indexReads = 0, historyReads = 0, detailReads = 0;
  const binding = Object.freeze({ tenant_id: "kling4-recovery-test", subject: "synthetic-owner" });
  const authProvider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "kling4-recovery-test", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-kling4-recovery-test" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(authProvider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai"); assert.equal(init.method ?? "GET", "GET");
    if (url.pathname === "/api/v1/chats" && url.search === "?scope=video&page=1&page_size=20") {
      indexReads++;
      const chats = TARGETS.map((target, index) => ({ id: rows.get(target.model_id)!.provider_chat_id, uuid: target.chat_uuid,
        title: options.mutation === "wrong_prefix" && options.mutationModel === target.model_id ? `owner-kling4-other-${target.chat_uuid}` : `owner-kling4-native-${target.chat_uuid}`,
        created_at: `2026-10-29T13:33:${10 + index}.000Z` }));
      return json({ chats, pagination: { page: 1, page_size: 20, total_count: chats.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (historyMatch) {
      historyReads++;
      const row = [...rows.values()].find(item => item.chat_uuid === historyMatch[1]); assert.ok(row);
      const target = row;
      const mutation = options.mutationModel === target.model_id ? options.mutation : undefined;
      const ownerObjects = mutation === "owner_reference" ? [
        { id: `owner-object-${target.model_id}-text`, message_id: target.owner_message_id, object_type: "text", model_type: target.model_id,
          object_text: target.expected_prompt, object_url: null, completed: true },
        { id: `owner-object-${target.model_id}-image`, message_id: target.owner_message_id, object_type: "image", model_type: target.model_id,
          object_text: null, object_url: "https://r2.syntx.ai/kling4-recovery-test/input.png", completed: true }
      ] : [{ id: `owner-object-${target.model_id}-text`, message_id: target.owner_message_id, object_type: "text",
        model_type: mutation === "wrong_owner_model" ? "kling_4_other" : target.model_id,
        object_text: mutation === "wrong_prompt" ? "Different synthetic prompt." : target.expected_prompt,
        object_url: null, completed: mutation === "owner_incomplete" ? false : true }];
      const kind = options.botKinds?.[target.model_id] ?? target.bot_kind;
      const botObject = { id: `bot-object-${target.model_id}`, message_id: target.provider_message_id, object_type: kind,
        model_type: target.model_id, object_url: kind === "video" ? mutation === "unsafe_url" ? "https://example.invalid/result.mp4" : OUTPUT_URL : null,
        completed: mutation === "bot_incomplete" ? false : true };
      return json({ messages: [
        { id: target.owner_message_id, chat_id: target.provider_chat_id, author_id: 42, message_object: ownerObjects },
        { id: target.provider_message_id, chat_id: target.provider_chat_id, author_id: -1, message_object: [botObject] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detailMatch = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (detailMatch) {
      detailReads++;
      const target = [...rows.values()].find(item => item.chat_uuid === detailMatch[1]); assert.ok(target);
      const mutation = options.mutationModel === target.model_id ? options.mutation : undefined;
      const kind = options.botKinds?.[target.model_id] ?? target.bot_kind;
      return json({ id: mutation === "detail_message_mismatch" ? "different-bot-message" : target.provider_message_id,
        chat_id: target.provider_chat_id, author_id: -1, message_object: [{ id: `bot-object-${target.model_id}`, message_id: target.provider_message_id,
          object_type: kind, model_type: target.model_id,
          object_url: kind === "video" ? mutation === "detail_url_mismatch" ? "https://r2.syntx.ai/kling4-recovery-test/other.mp4" : OUTPUT_URL : null,
          completed: true }] });
    }
    throw new Error("Unexpected GET route");
  };
  const chat = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } }, fetchImpl, requestTimeoutMs: 1_000 });
  const service = new OwnerExistingVideoRecoveryService({ binding, linkService: links, resolveChatClient: () => chat, now: () => now });
  return { service, counts: () => ({ indexReads, historyReads, detailReads }), async close() { await service.close(); } };
}
async function readViaMcp(service: OwnerExistingVideoRecoveryService, targets: readonly unknown[]) {
  const server = new McpServer({ name: "kling4-existing-recovery", version: "1" });
  const client = new Client({ name: "kling4-existing-recovery-client", version: "1" });
  registerOwnerExistingVideoResultTools(server, { recoveryService: service });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  await server.connect(host); await client.connect(caller);
  try {
    return await client.callTool({ name: OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, targets } });
  } finally { await client.close(); await server.close(); }
}

test("MCP SDK returns only history/detail-bound no-reference K4 video and provider error", async () => {
  const f = await fixture();
  try {
    const result = await readViaMcp(f.service, TARGETS);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const data = result.structuredContent as { results: Array<{ model_id: string; status: string; object_url?: string; provider_error_code?: string; proof: string }>;
      read_counts: { index_gets: number; history_gets: number; detail_gets: number }; provider_terminal_status: string };
    assert.deepEqual(data.results.map(row => [row.model_id, row.status, row.proof]), [
      ["kling_4_keyframes", "video", "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND"],
      ["kling_4_omni", "provider_error", "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND"]
    ]);
    assert.equal(data.results[0]?.object_url, OUTPUT_URL);
    assert.equal(data.results[1]?.object_url, undefined);
    assert.equal(data.results[1]?.provider_error_code, "PROVIDER_ERROR_OBJECT_OBSERVED");
    assert.equal(data.provider_terminal_status, "UNPROVEN");
    assert.deepEqual(data.read_counts, { index_gets: 1, history_gets: 2, detail_gets: 2 });
    assert.deepEqual(f.counts(), { indexReads: 1, historyReads: 2, detailReads: 2 });
  } finally { await f.close(); }
});

test("MCP SDK recovers an existing no-reference Kling 4 Omni video without dispatch", async () => {
  const f = await fixture({ botKinds: { kling_4_omni: "video" } });
  try {
    const result = await readViaMcp(f.service, [TARGETS[1]]);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const data = result.structuredContent as { status: string; results: Array<{ model_id: string; status: string; object_url?: string; proof: string }>;
      read_counts: { index_gets: number; history_gets: number; detail_gets: number } };
    assert.equal(data.status, "complete");
    assert.deepEqual(data.results.map(row => [row.model_id, row.status, row.proof, row.object_url]), [
      ["kling_4_omni", "video", "CURRENT_LINK_INDEX_HISTORY_DETAIL_BOUND", OUTPUT_URL]
    ]);
    assert.deepEqual(data.read_counts, { index_gets: 1, history_gets: 1, detail_gets: 1 });
    assert.deepEqual(f.counts(), { indexReads: 1, historyReads: 1, detailReads: 1 });
  } finally { await f.close(); }
});

test("MCP SDK fails closed on K4 no-reference mismatches before returning a URL", async () => {
  const cases: Array<{ mutation: Mutation; mutationModel: Model; gap: string; history: number; detail: number }> = [
    { mutation: "wrong_prefix", mutationModel: "kling_4_keyframes", gap: "INDEX_MEMBERSHIP_MISMATCH", history: 0, detail: 0 },
    { mutation: "wrong_prompt", mutationModel: "kling_4_keyframes", gap: "OWNER_PROMPT_MISMATCH", history: 1, detail: 0 },
    { mutation: "wrong_owner_model", mutationModel: "kling_4_omni", gap: "OWNER_MODEL_OR_REFERENCE_MISMATCH", history: 1, detail: 0 },
    { mutation: "owner_reference", mutationModel: "kling_4_keyframes", gap: "OWNER_MODEL_OR_REFERENCE_MISMATCH", history: 1, detail: 0 },
    { mutation: "owner_incomplete", mutationModel: "kling_4_omni", gap: "OWNER_MODEL_OR_REFERENCE_MISMATCH", history: 1, detail: 0 },
    { mutation: "bot_incomplete", mutationModel: "kling_4_keyframes", gap: "BOT_MODEL_OR_TYPE_MISMATCH", history: 1, detail: 0 },
    { mutation: "detail_url_mismatch", mutationModel: "kling_4_keyframes", gap: "DETAIL_OBJECT_MISMATCH", history: 1, detail: 1 },
    { mutation: "detail_message_mismatch", mutationModel: "kling_4_omni", gap: "DETAIL_BINDING_MISMATCH", history: 1, detail: 1 },
    { mutation: "unsafe_url", mutationModel: "kling_4_keyframes", gap: "BOT_MODEL_OR_TYPE_MISMATCH", history: 1, detail: 0 }
  ];
  for (const item of cases) {
    const f = await fixture(item);
    try {
      const result = await readViaMcp(f.service, TARGETS.filter(target => target.model_id === item.mutationModel));
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const data = result.structuredContent as { results: Array<{ model_id: string; status: string; object_url?: string; gaps: string[] }>;
        read_counts: { index_gets: number; history_gets: number; detail_gets: number } };
      const row = data.results.find(value => value.model_id === item.mutationModel);
      assert.equal(row?.status, "unverified", item.mutation);
      assert.equal(row?.object_url, undefined, item.mutation);
      assert.equal(row?.gaps[0], item.gap, item.mutation);
      assert.equal(data.read_counts.index_gets, 1);
      assert.equal(data.read_counts.history_gets, item.history);
      assert.equal(data.read_counts.detail_gets, item.detail);
      assert.deepEqual(f.counts(), { indexReads: 1, historyReads: item.history, detailReads: item.detail });
    } finally { await f.close(); }
  }
});
