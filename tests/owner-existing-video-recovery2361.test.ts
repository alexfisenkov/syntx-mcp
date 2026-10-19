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

const ATTEMPT = "link_existing_video2361_owner_0123456789abcdef";
const OUTPUT_URL = "https://r2.syntx.ai/existing-video2361/result.mp4";
const OWNER_ROWS = [
  { model_id: "dop-lite", uuid: "11111111-1111-4111-8111-111111111111", chat_id: "5001", owner_id: "7001", bot_id: "7002", kind: "error" },
  { model_id: "dop-turbo", uuid: "22222222-2222-4222-8222-222222222222", chat_id: "5002", owner_id: "7003", bot_id: "7004", kind: "error" },
  { model_id: "hailuo-2.3-fast", uuid: "33333333-3333-4333-8333-333333333333", chat_id: "5003", owner_id: "7005", bot_id: "7006", kind: "video" },
  { model_id: "hailuo-01-live-character", uuid: "44444444-4444-4444-8444-444444444444", chat_id: "5004", owner_id: "7007", bot_id: "7008", kind: "video" },
  { model_id: "wan_27_i2v", uuid: "55555555-5555-4555-8555-555555555555", chat_id: "5005", owner_id: "7009", bot_id: "7010", kind: "video" },
  { model_id: "gen4.5i2v", uuid: "66666666-6666-4666-8666-666666666666", chat_id: "5006", owner_id: "7011", bot_id: "7012", kind: "video" }
] as const;
const EXTENSION_ROWS = [
  { model_id: "hailuo-3.0", uuid: "88888888-8888-4888-8888-888888888888", chat_id: "5008", owner_id: "7015", bot_id: "7016", kind: "video" },
  { model_id: "kling_elements", uuid: "99999999-9999-4999-8999-999999999999", chat_id: "5009", owner_id: "7017", bot_id: "7018", kind: "error" },
  { model_id: "kling_o1_image2video", uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", chat_id: "5011", owner_id: "7019", bot_id: "7020", kind: "video" },
  { model_id: "acttwo", uuid: "15151515-1515-4515-8515-151515151515", chat_id: "5012", owner_id: "7021", bot_id: "7022", kind: "video" }
] as const;
const NEW_ROWS = [
  { model_id: "seedance-2.5", uuid: "17171717-1717-4717-8717-171717171717", chat_id: "5013", owner_id: "7023", bot_id: "7024", kind: "video" },
  { model_id: "switchx", uuid: "18181818-1818-4818-8818-181818181818", chat_id: "5014", owner_id: "7025", bot_id: "7026", kind: "video" }
] as const;
const ALL_ROWS = [...OWNER_ROWS, ...EXTENSION_ROWS, ...NEW_ROWS];
const INDEX_TITLE_UUIDS = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "12121212-1212-4212-8212-121212121212", "13131313-1313-4313-8313-131313131313", "14141414-1414-4414-8414-141414141414",
  "16161616-1616-4616-8616-161616161616", "19191919-1919-4919-8919-191919191919", "20202020-2020-4020-8020-202020202020"] as const;
const promptFor = (model: string) => model === "acttwo" ? "" : `Synthetic test prompt for ${model}.`;
const titlePrefix = (model: string) => model.startsWith("dop-") ? "owner-higgsfield-dop-" : model.startsWith("hailuo-") ? "owner-hailuo-initial-" :
  model.startsWith("kling_") ? "owner-kling-media-" : model === "acttwo" ? "owner-acttwo-" : model === "wan_27_i2v" ? "owner-wan27-i2v-" :
    model === "seedance-2.5" ? "owner-contract-video-" : model === "switchx" ? "owner-switchx-video-" : "owner-runway-i2v-";
const targets = OWNER_ROWS.map(row => ({ model_id: row.model_id, chat_uuid: row.uuid, owner_message_id: row.owner_id,
  provider_message_id: row.bot_id, expected_prompt: promptFor(row.model_id) }));
const extensionTargets = EXTENSION_ROWS.map(row => ({ model_id: row.model_id, chat_uuid: row.uuid, owner_message_id: row.owner_id,
  provider_message_id: row.bot_id, expected_prompt: promptFor(row.model_id) }));
const newTargets = NEW_ROWS.map(row => ({ model_id: row.model_id, chat_uuid: row.uuid, owner_message_id: row.owner_id,
  provider_message_id: row.bot_id, expected_prompt: promptFor(row.model_id) }));
const actTwoTarget = extensionTargets.find(row => row.model_id === "acttwo")!;
const SWITCHX_OUTPUT_URLS = ["https://r2.syntx.ai/existing-video2361/switchx-output-0.mp4", "https://r2.syntx.ai/existing-video2361/switchx-output-1.mp4"] as const;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

async function fixture(options: { readonly mismatchedModel?: string; readonly mismatchedDetailId?: string; readonly mismatchedDetailObjectId?: string; readonly mismatchedOwnerChat?: string;
  readonly mismatchedTitle?: string; readonly wrongTitlePrefix?: string;
  readonly actTwoTextMode?: "absent" | "empty" | "null";
  readonly switchxMutation?: "mixed_owner_model" | "missing_bot_object" | "duplicate_bot_id" | "duplicate_bot_url" | "detail_id_mismatch" | "detail_url_mismatch";
  readonly seedanceMutation?: "extra_owner_object" | "wrong_prompt" | "nonempty_url";
  readonly responseKinds?: Readonly<Record<string, "video" | "error">> } = {}) {
  let now = Date.parse("2026-10-19T16:00:00.000Z"), indexReads = 0, historyReads = 0, detailReads = 0;
  const binding = Object.freeze({ tenant_id: "existing-video2361-test", subject: "synthetic-current-owner" });
  const authProvider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "existing-video2361", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-existing-video2361" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(authProvider, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai"); assert.equal(init.method ?? "GET", "GET");
    if (url.pathname === "/api/v1/chats" && url.search === "?scope=video&page=1&page_size=20") {
      indexReads++; return json({ chats: [...ALL_ROWS.map((row, index) => ({ id: Number(row.chat_id), uuid: row.uuid,
        title: options.mismatchedTitle === row.model_id ? `${titlePrefix(row.model_id)}not-a-chat-uuid` :
          `${options.wrongTitlePrefix === row.model_id ? "owner-unrelated-video-" : titlePrefix(row.model_id)}${INDEX_TITLE_UUIDS[index]}`,
        created_at: "2026-10-19T15:22:00.123456+00:00" })),
        { id: 5010, uuid: "77777777-7777-4777-8777-777777777777", scope: "video", title: "unrelated-chat", created_at: "2026-10-19T15:22:00.000Z" }],
        pagination: { page: 1, page_size: 20, total_count: ALL_ROWS.length + 1, total_pages: 1, has_next: false, has_previous: false } });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history) {
      historyReads++; const row = ALL_ROWS.find(item => item.uuid === history[1]); assert.ok(row);
      const ownerChat = options.mismatchedOwnerChat === row.model_id ? 999999 : Number(row.chat_id);
      const modelEcho = options.mismatchedModel === row.model_id ? "wrong-model" : row.model_id;
      const responseKind = options.responseKinds?.[row.model_id] ?? row.kind;
      const ownerObjects = row.model_id === "switchx" ? [
        { id: Number(row.owner_id) + 1_000, message_id: Number(row.owner_id), object_type: "text", model_type: modelEcho,
          object_text: promptFor(row.model_id), object_url: null, completed: true },
        { id: Number(row.owner_id) + 1_001, message_id: Number(row.owner_id), object_type: "video",
          model_type: options.switchxMutation === "mixed_owner_model" ? "wrong-model" : modelEcho,
          object_text: null, object_url: "https://r2.syntx.ai/existing-video2361/switchx-input.mp4", completed: true }
      ] : row.model_id === "seedance-2.5" ? [
        { id: Number(row.owner_id) + 1_000, message_id: Number(row.owner_id), object_type: "text", model_type: modelEcho,
          object_text: options.seedanceMutation === "wrong_prompt" ? "Different synthetic prompt." : promptFor(row.model_id),
          object_url: options.seedanceMutation === "nonempty_url" ? "https://example.invalid/unexpected.mp4" : "", completed: true },
        ...(options.seedanceMutation === "extra_owner_object" ? [{ id: Number(row.owner_id) + 1_001, message_id: Number(row.owner_id),
          object_type: "image", model_type: modelEcho, object_text: null, object_url: "https://r2.syntx.ai/existing-video2361/unexpected.png", completed: true }] : [])
      ] : row.model_id === "acttwo" ? [
        { id: Number(row.owner_id) + 1_001, message_id: Number(row.owner_id), object_type: "image", model_type: modelEcho, object_text: null,
          object_url: "https://r2.syntx.ai/existing-video2361/input.png" },
        { id: Number(row.owner_id) + 1_000, message_id: Number(row.owner_id), object_type: "video", model_type: modelEcho, object_text: null,
          object_url: "https://r2.syntx.ai/existing-video2361/input.mp4" },
        ...(options.actTwoTextMode === "absent" ? [] : [{ id: Number(row.owner_id) + 1_002, message_id: Number(row.owner_id), object_type: "text",
          model_type: null, object_text: options.actTwoTextMode === "null" ? null : "", object_url: null }])
      ] : [
        { id: Number(row.owner_id) + 1_000, message_id: Number(row.owner_id), object_type: "text", model_type: null, object_text: promptFor(row.model_id), object_url: null, completed: null },
        { id: Number(row.owner_id) + 1_001, message_id: Number(row.owner_id), object_type: "image", model_type: modelEcho, object_text: null, object_url: "https://r2.syntx.ai/existing-video2361/input.png" }
      ];
      const switchxBotObjects = (source: "history" | "detail") => [
        { id: Number(row.bot_id) + 1_000, message_id: Number(row.bot_id), object_type: "video", model_type: "switchx",
          object_url: SWITCHX_OUTPUT_URLS[0], object_text: null, completed: true },
        { id: Number(row.bot_id) + (source === "history" && options.switchxMutation === "duplicate_bot_id" ? 1_000 : 1_001),
          message_id: Number(row.bot_id), object_type: "video", model_type: "switchx",
          object_url: source === "history" && options.switchxMutation === "duplicate_bot_url" || source === "detail" && options.switchxMutation === "detail_url_mismatch"
            ? SWITCHX_OUTPUT_URLS[0] : SWITCHX_OUTPUT_URLS[1], object_text: null, completed: true }
      ];
      const botObjects = row.model_id === "switchx" ? switchxBotObjects("history").slice(0, options.switchxMutation === "missing_bot_object" ? 1 : 2) : [
        { id: Number(row.bot_id) + 1_000, message_id: Number(row.bot_id), object_type: responseKind, model_type: row.model_id,
          object_url: responseKind === "video" ? OUTPUT_URL : undefined, object_text: responseKind === "error" ? "SECRET provider internals" : undefined,
          completed: true }
      ];
      return json({ messages: [
        { id: Number(row.owner_id), chat_id: ownerChat, author_id: 42, message_object: ownerObjects },
        { id: Number(row.bot_id), chat_id: Number(row.chat_id), author_id: -1, message_object: botObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detail = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (detail) {
      detailReads++; const row = ALL_ROWS.find(item => item.uuid === detail[1]); assert.ok(row);
      const id = options.mismatchedDetailId === row.model_id ? Number(row.bot_id) + 999 : Number(row.bot_id);
      const objectId = options.mismatchedDetailObjectId === row.model_id ? Number(row.bot_id) + 2_000 : Number(row.bot_id) + 1_000;
      const responseKind = options.responseKinds?.[row.model_id] ?? row.kind;
      const object = responseKind === "video" ? { id: objectId, message_id: Number(row.bot_id), object_type: "video", object_url: OUTPUT_URL,
        model_type: row.model_id, completed: true } : { id: Number(row.bot_id) + 1_000, message_id: Number(row.bot_id), object_type: "error", object_text: "SECRET provider internals",
        model_type: row.model_id, completed: true };
      const switchxObjects = row.model_id === "switchx" ? [
        { id: Number(row.bot_id) + 1_000, message_id: Number(row.bot_id), object_type: "video", model_type: "switchx",
          object_url: SWITCHX_OUTPUT_URLS[0], object_text: null, completed: true },
        { id: Number(row.bot_id) + (options.switchxMutation === "detail_id_mismatch" ? 9_999 : 1_001), message_id: Number(row.bot_id),
          object_type: "video", model_type: "switchx", object_url: options.switchxMutation === "detail_url_mismatch" ? SWITCHX_OUTPUT_URLS[0] : SWITCHX_OUTPUT_URLS[1],
          object_text: null, completed: true }
      ].slice(0, options.switchxMutation === "missing_bot_object" ? 1 : 2) : [object];
      return json({ id, chat_id: Number(row.chat_id), author_id: -1, message_object: switchxObjects });
    }
    throw new Error(`Unexpected GET route ${url.pathname}`);
  };
  const chat = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>): Promise<T> {
    return links.useCredential(binding, ATTEMPT, credential => use(credential.value));
  } }, fetchImpl, requestTimeoutMs: 1_000 });
  const service = new OwnerExistingVideoRecoveryService({ binding, linkService: links, resolveChatClient: () => chat, now: () => now });
  return { service, counts: () => ({ indexReads, historyReads, detailReads }), async close() { await service.close(); } };
}

test("MCP SDK reads only caller-bound owner chats, returns videos and sanitized provider errors", async () => {
  const f = await fixture(), server = new McpServer({ name: "existing-video2361", version: "1" }), client = new Client({ name: "existing-video2361-client", version: "1" });
  assert.ok(OWNER_ROWS.every((row, index) => String(INDEX_TITLE_UUIDS[index]) !== String(row.uuid)));
  registerOwnerExistingVideoResultTools(server, { recoveryService: f.service }); const [caller, host] = InMemoryTransport.createLinkedPair();
  try { await server.connect(host); await client.connect(caller);
    const result = await client.callTool({ name: OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, targets } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const structured = result.structuredContent as { results: Array<{ model_id: string; status: string; object_url?: string; provider_error_code?: string }>;
      read_counts: { index_gets: number; history_gets: number; detail_gets: number } };
    const rows = structured.results;
    assert.equal(rows.length, 6); assert.equal(rows.filter(row => row.status === "video").length, 4, JSON.stringify(rows)); assert.equal(rows.filter(row => row.status === "provider_error").length, 2, JSON.stringify(rows));
    assert.ok(rows.filter(row => row.status === "video").every(row => row.object_url === OUTPUT_URL));
    assert.ok(rows.filter(row => row.status === "provider_error").every(row => row.provider_error_code === "PROVIDER_ERROR_OBJECT_OBSERVED"));
    assert.equal(JSON.stringify(result).includes("SECRET provider internals"), false);
    assert.deepEqual(structured.read_counts, { index_gets: 1, history_gets: 6, detail_gets: 6 });
    assert.deepEqual(f.counts(), { indexReads: 1, historyReads: 6, detailReads: 6 });
  } finally { await client.close(); await server.close(); await f.close(); }
});

test("existing-video reader fails closed on prompt, owner-chat, model, and result-ID mismatches", async () => {
  for (const options of [{ mismatchedOwnerChat: "dop-lite" }, { mismatchedModel: "dop-lite" }, { mismatchedDetailId: "dop-lite" },
    { mismatchedDetailObjectId: "hailuo-2.3-fast" }, { mismatchedTitle: "dop-lite" }]) {
    const f = await fixture(options);
    try { const result = await f.service.readExistingVideos({ attemptId: ATTEMPT, targets });
      const mismatchedModel = options.mismatchedDetailObjectId ? "hailuo-2.3-fast" : "dop-lite";
      const row = result.results.find(item => item.model_id === mismatchedModel); assert.equal(row?.status, "unverified");
      assert.equal(f.counts().detailReads, options.mismatchedDetailId || options.mismatchedDetailObjectId ? 6 : 5);
    } finally { await f.close(); }
  }
  const wrongPromptTargets = targets.map(row => row.model_id === "dop-lite" ? { ...row, expected_prompt: "different prompt" } : row);
  const f = await fixture();
  try { const result = await f.service.readExistingVideos({ attemptId: ATTEMPT, targets: wrongPromptTargets });
    assert.equal(result.results.find(row => row.model_id === "dop-lite")?.gaps[0], "OWNER_PROMPT_MISMATCH");
    assert.equal(f.counts().detailReads, 5);
  } finally { await f.close(); }

  const flipped = await fixture({ responseKinds: { "dop-lite": "video", "hailuo-2.3-fast": "error" } });
  try { const result = await flipped.service.readExistingVideos({ attemptId: ATTEMPT, targets });
    assert.equal(result.results.find(row => row.model_id === "dop-lite")?.status, "video_available");
    assert.equal(result.results.find(row => row.model_id === "hailuo-2.3-fast")?.status, "provider_error");
    assert.deepEqual(flipped.counts(), { indexReads: 1, historyReads: 6, detailReads: 6 });
  } finally { await flipped.close(); }

  for (const [index, target] of extensionTargets.entries()) {
    const observedKind = index === 1 ? "video" : "error";
    const expectedStatus = observedKind === "video" ? "video" : "provider_error";
    const f = await fixture({ responseKinds: { [target.model_id]: observedKind } });
    const server = new McpServer({ name: "existing-video-extension2361", version: "1" });
    const client = new Client({ name: "existing-video-extension2361-client", version: "1" });
    registerOwnerExistingVideoResultTools(server, { recoveryService: f.service }); const [caller, host] = InMemoryTransport.createLinkedPair();
    try { await server.connect(host); await client.connect(caller);
      const result = await client.callTool({ name: OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME,
        arguments: { link_attempt_id: ATTEMPT, targets: [target] } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const structured = result.structuredContent as { results: Array<{ model_id: string; status: string }>; read_counts: { history_gets: number; detail_gets: number } };
      assert.equal(structured.results.length, 1); assert.equal(structured.results[0]?.model_id, target.model_id);
      assert.equal(structured.results[0]?.status, expectedStatus);
      assert.deepEqual(structured.read_counts, { index_gets: 1, history_gets: 1, detail_gets: 1 });
      assert.deepEqual(f.counts(), { indexReads: 1, historyReads: 1, detailReads: 1 });
    } finally { await client.close(); await server.close(); await f.close(); }
  }
  const actTwo = await fixture({ actTwoTextMode: "empty" });
  const actTwoServer = new McpServer({ name: "existing-video-acttwo2361", version: "1" });
  const actTwoClient = new Client({ name: "existing-video-acttwo2361-client", version: "1" });
  registerOwnerExistingVideoResultTools(actTwoServer, { recoveryService: actTwo.service }); const [actTwoCaller, actTwoHost] = InMemoryTransport.createLinkedPair();
  try { await actTwoServer.connect(actTwoHost); await actTwoClient.connect(actTwoCaller);
    const result = await actTwoClient.callTool({ name: OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, targets: [actTwoTarget] } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal((result.structuredContent as { results: Array<{ model_id: string; status: string }> }).results[0]?.status, "video");
    assert.deepEqual(actTwo.counts(), { indexReads: 1, historyReads: 1, detailReads: 1 });
  } finally { await actTwoClient.close(); await actTwoServer.close(); await actTwo.close(); }

  for (const actTwoTextMode of ["absent", "null"] as const) {
    const f = await fixture({ actTwoTextMode });
    try { const result = await f.service.readExistingVideos({ attemptId: ATTEMPT, targets: [actTwoTarget] });
      assert.equal(result.results[0]?.status, "video_available");
    } finally { await f.close(); }
  }
  const foreignActTwo = await fixture({ mismatchedModel: "acttwo" });
  try { const result = await foreignActTwo.service.readExistingVideos({ attemptId: ATTEMPT, targets: [actTwoTarget] });
    assert.equal(result.results[0]?.gaps[0], "OWNER_MODEL_OR_REFERENCE_MISMATCH");
    assert.deepEqual(foreignActTwo.counts(), { indexReads: 1, historyReads: 1, detailReads: 0 });
  } finally { await foreignActTwo.close(); }
  const rejectedPrompt = await fixture();
  try { await assert.rejects(() => rejectedPrompt.service.readExistingVideos({ attemptId: ATTEMPT,
      targets: [{ ...actTwoTarget, expected_prompt: "unexpected nonempty text" }] }), error => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.deepEqual(rejectedPrompt.counts(), { indexReads: 0, historyReads: 0, detailReads: 0 });
    await assert.rejects(() => rejectedPrompt.service.readExistingVideos({ attemptId: ATTEMPT,
      targets: [{ ...targets[0]!, expected_prompt: "" }] }), error => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  } finally { await rejectedPrompt.close(); }
  const wrongFamily = await fixture({ wrongTitlePrefix: "kling_elements" });
  try { const result = await wrongFamily.service.readExistingVideos({ attemptId: ATTEMPT, targets: [extensionTargets[1]] });
    assert.equal(result.results[0]?.gaps[0], "INDEX_MEMBERSHIP_MISMATCH");
    assert.deepEqual(wrongFamily.counts(), { indexReads: 1, historyReads: 0, detailReads: 0 });
  } finally { await wrongFamily.close(); }
});

test("MCP SDK reads Seedance25 no-reference and ordered Switchx dual-video results", async () => {
  const f = await fixture(), server = new McpServer({ name: "existing-video-new-media2361", version: "1" }),
    client = new Client({ name: "existing-video-new-media2361-client", version: "1" });
  registerOwnerExistingVideoResultTools(server, { recoveryService: f.service }); const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const result = await client.callTool({ name: OWNER_EXISTING_VIDEO_RESULT_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, targets: newTargets } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const structured = result.structuredContent as { results: Array<{ model_id: string; status: string; object_url?: string;
      artifacts?: Array<{ object_url: string; mime_type: string | null }> }>; read_counts: { index_gets: number; history_gets: number; detail_gets: number } };
    const seedance = structured.results.find(row => row.model_id === "seedance-2.5");
    assert.equal(seedance?.status, "video"); assert.equal(seedance?.object_url, OUTPUT_URL); assert.equal(seedance?.artifacts, undefined);
    const switchx = structured.results.find(row => row.model_id === "switchx");
    assert.equal(switchx?.status, "video"); assert.equal(switchx?.object_url, SWITCHX_OUTPUT_URLS[0]);
    assert.deepEqual(switchx?.artifacts, [{ object_url: SWITCHX_OUTPUT_URLS[0], mime_type: null },
      { object_url: SWITCHX_OUTPUT_URLS[1], mime_type: null }]);
    assert.equal(JSON.stringify(result).includes("switchx-input.mp4"), false);
    assert.deepEqual(structured.read_counts, { index_gets: 1, history_gets: 2, detail_gets: 2 });
    assert.deepEqual(f.counts(), { indexReads: 1, historyReads: 2, detailReads: 2 });
  } finally { await client.close(); await server.close(); await f.close(); }
});

test("new recovery profiles reject mixed, missing, duplicate, and history/detail-mismatched Switchx artifacts", async () => {
  const cases = [
    { switchxMutation: "mixed_owner_model" as const, gap: "OWNER_MODEL_OR_REFERENCE_MISMATCH", details: 0 },
    { switchxMutation: "missing_bot_object" as const, gap: "BOT_MODEL_OR_TYPE_MISMATCH", details: 0 },
    { switchxMutation: "duplicate_bot_id" as const, gap: "BOT_MODEL_OR_TYPE_MISMATCH", details: 0 },
    { switchxMutation: "duplicate_bot_url" as const, gap: "BOT_MODEL_OR_TYPE_MISMATCH", details: 0 },
    { switchxMutation: "detail_id_mismatch" as const, gap: "DETAIL_OBJECT_MISMATCH", details: 1 },
    { switchxMutation: "detail_url_mismatch" as const, gap: "DETAIL_OBJECT_MISMATCH", details: 1 }
  ];
  for (const item of cases) {
    const f = await fixture({ switchxMutation: item.switchxMutation });
    try {
      const result = await f.service.readExistingVideos({ attemptId: ATTEMPT, targets: [newTargets[1]] });
      assert.equal(result.results[0]?.status, "unverified", item.switchxMutation);
      assert.equal(result.results[0]?.gaps[0], item.gap, item.switchxMutation);
      assert.equal(f.counts().detailReads, item.details, item.switchxMutation);
    } finally { await f.close(); }
  }
  const f = await fixture({ seedanceMutation: "wrong_prompt" });
  try {
    const result = await f.service.readExistingVideos({ attemptId: ATTEMPT, targets: [newTargets[0]] });
    assert.equal(result.results[0]?.status, "unverified"); assert.equal(result.results[0]?.gaps[0], "OWNER_PROMPT_MISMATCH");
    assert.deepEqual(f.counts(), { indexReads: 1, historyReads: 1, detailReads: 0 });
  } finally { await f.close(); }
  const withUrl = await fixture({ seedanceMutation: "nonempty_url" });
  try {
    const result = await withUrl.service.readExistingVideos({ attemptId: ATTEMPT, targets: [newTargets[0]] });
    assert.equal(result.results[0]?.status, "unverified"); assert.equal(result.results[0]?.gaps[0], "OWNER_MODEL_OR_REFERENCE_MISMATCH");
    assert.deepEqual(withUrl.counts(), { indexReads: 1, historyReads: 1, detailReads: 0 });
  } finally { await withUrl.close(); }
});
