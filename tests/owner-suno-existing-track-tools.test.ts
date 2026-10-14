import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_SUNO_EXISTING_TRACK_TOOL_NAMES,
  OWNER_SUNO_EXISTING_TRACK_TOOL_OUTPUT_SCHEMA,
  SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME
} from "../src/mcp/owner-suno-existing-track-tools.js";
import { OWNER_SUNO_GENERATION_TOOL_NAMES } from "../src/mcp/owner-suno-generation-tools.js";

const ATTEMPT = "link_suno_existing_mcp_1329_owner_0123456789";
const OTHER_ATTEMPT = "link_suno_existing_mcp_1329_other_0123456789";
const CHAT = "owner-suno-existing-mcp-chat-1329";
const ACK = "owner-suno-existing-mcp-ack-1329";
const RESULT = "owner-suno-existing-mcp-result-1329";
const OBJECT = "private-object-existing-mcp-1329";
const CLIP = "private-clip-existing-mcp-1329";
const TASK = "private-task-existing-mcp-1329";
const PROMPT = "private prompt existing-mcp-1329";
const ARTIFACT_URL = "https://r2.syntx.ai/audio/existing-mcp-1329.mp3";

function makeHarness(options: { failHistory?: boolean } = {}) {
  const now = Date.parse("2026-10-14T00:00:00.000Z");
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    events.push(`${method} ${url.pathname}${url.search}`);
    if (method !== "GET") throw new Error("Unexpected POST in read-only fixture");
    if (url.pathname === "/api/v1/chats") return Response.json({ chats: [{ id: 9031, uuid: CHAT, scope: "audio",
      title: "owner-suno-track-operation-01234567-89ab-4def-8123-456789abcdef",
      created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z", message_count: 2 }],
      pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT}/messages`) {
      if (options.failHistory) throw new Error(`untrusted upstream ${CLIP}`);
      return Response.json({ messages: [
        { id: ACK, chat_id: 9031, author_id: 42, message_object: [{ id: "existing-mcp-ack-object", message_id: ACK,
          object_type: "text", object_text: PROMPT, object_url: "", completed: true, model_type: "V6", metadata: { payload: {} } }] },
        { id: RESULT, chat_id: 9031, author_id: -1, message_object: [{ id: OBJECT, message_id: RESULT,
          object_type: "audio", object_text: "", object_url: ARTIFACT_URL, completed: true, model_type: "V6",
          metadata: { payload: { clip_id: CLIP, task_id: TASK } } }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${RESULT}`) return Response.json({ id: RESULT, chat_id: 9031, author_id: -1,
        message_object: [{ id: OBJECT, message_id: RESULT, object_type: "audio", object_url: ARTIFACT_URL, completed: true,
        object_text: "", model_type: "V6", metadata: { payload: { clip_id: CLIP, task_id: TASK } } }], created_at: "2026-10-14T00:00:00Z" });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl, now: () => now });
  return { runtime, events };
}

async function linkAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string, now: number,
  binding = runtime.authBinding): Promise<void> {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: now + 24 * 60 * 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

async function connect(runtime: ReturnType<typeof createObservedOwnerRuntime>, name: string) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, close: async () => { await Promise.all([client.close(), server.close()]); } };
}

function errorText(result: unknown): string {
  const content = (result as { content?: readonly { type: string; text?: string }[] }).content ?? [];
  return content.find((item) => item.type === "text")?.text ?? "";
}

test("existing Suno track tool is default-off and shares only the existing generation opt-in", async () => {
  let startupCalls = 0;
  const defaults = createObservedOwnerRuntime({ fetchImpl: async () => { startupCalls += 1; throw new Error("unexpected fetch"); } });
  const defaultConnection = await connect(defaults, "existing-suno-default-off-1329");
  try {
    const names = (await defaultConnection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.includes(SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME), false);
    assert.equal(startupCalls, 0);
  } finally {
    await defaultConnection.close();
    await defaults.ownerSunoGenerationLifecycle?.close();
  }

  const harness = makeHarness();
  const connection = await connect(harness.runtime, "existing-suno-opt-in-1329");
  try {
    const names = (await connection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.filter((name) => name === SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME).length, 1);
    assert.deepEqual(names.filter((name) => (OWNER_SUNO_GENERATION_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_SUNO_GENERATION_TOOL_NAMES].sort());
    assert.deepEqual(OWNER_SUNO_EXISTING_TRACK_TOOL_NAMES, [SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME]);
    assert.deepEqual(harness.events, [], "tool registration must not perform startup I/O");
  } finally {
    await connection.close();
    await harness.runtime.ownerSunoGenerationLifecycle?.close();
  }
});

test("lists owner-bound imported tracks with the exact associated artifact and strict GET-only input", async () => {
  const harness = makeHarness();
  const connection = await connect(harness.runtime, "existing-suno-result-1329");
  const now = Date.parse("2026-10-14T00:00:00.000Z");
  try {
    await linkAttempt(harness.runtime, ATTEMPT, now);
    await linkAttempt(harness.runtime, OTHER_ATTEMPT, now, { tenant_id: "foreign-tenant", subject: "foreign-owner" });
    const result = await connection.client.callTool({ name: SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, undefined, `${errorText(result)} events=${JSON.stringify(harness.events)}`);
    const output = result.structuredContent as Record<string, unknown>;
    assert.deepEqual(Object.keys(output).sort(), ["has_next", "has_previous", "page", "page_size", "status", "total_count", "total_pages", "tracks"].sort());
    assert.deepEqual(Object.keys(JSON.parse(errorText(result)) as Record<string, unknown>).sort(), Object.keys(output).sort());
    assert.equal(output.status, "AVAILABLE");
    assert.equal(output.page, 1);
    assert.equal(output.page_size, 20);
    assert.equal(output.total_count, 1);
    assert.equal(output.total_pages, 1);
    assert.equal(output.has_next, false);
    assert.equal(output.has_previous, false);
    assert.equal(Object.hasOwn(output, "unavailable_reason"), false);
    const tracks = output.tracks as Record<string, unknown>[];
    assert.equal(tracks.length, 1);
    assert.deepEqual(tracks[0]!.artifact, { url: ARTIFACT_URL, mime_type: "audio/mpeg" });
    assert.equal(tracks[0]!.model_id, "V6");
    assert.match(String(tracks[0]!.track_handle), /^track_[0-9a-f-]{36}$/u);
    assert.ok(Number.isInteger(tracks[0]!.expires_in_seconds) && Number(tracks[0]!.expires_in_seconds) >= 1 &&
      Number(tracks[0]!.expires_in_seconds) <= 1_800);
    const serialized = JSON.stringify(output);
    for (const privateValue of [CHAT, ACK, RESULT, OBJECT, CLIP, TASK, PROMPT, "principal", "credential"]) {
      assert.equal(serialized.includes(privateValue), false, `response must redact ${privateValue}`);
    }
    assert.deepEqual(harness.events, [
      "GET /api/v1/chats?scope=audio&page=1&page_size=20",
      `GET /api/v1/chats/${CHAT}/messages?page=1&page_size=10`,
      `GET /api/v1/chats/${CHAT}/${RESULT}`
    ]);

    for (const arguments_ of [
      { link_attempt_id: "bad-attempt" },
      { link_attempt_id: ATTEMPT, page: 0 },
      { link_attempt_id: ATTEMPT, page: 101 },
      { link_attempt_id: ATTEMPT, unknown: true },
      { link_attempt_id: ATTEMPT, clip_id: CLIP },
      { link_attempt_id: ATTEMPT, source_url: ARTIFACT_URL }
    ]) {
      const invalid = await connection.client.callTool({ name: SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME, arguments: arguments_ });
      assert.equal(invalid.isError, true);
      assert.equal(harness.events.length, 3, "invalid input must be rejected before upstream work");
    }
    const foreign = await connection.client.callTool({ name: SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME,
      arguments: { link_attempt_id: OTHER_ATTEMPT } });
    assert.equal(foreign.isError, true);
    assert.equal(harness.events.length, 3, "foreign principal rejection must not read upstream");
  } finally {
    await connection.close();
    await harness.runtime.ownerSunoGenerationLifecycle?.close();
  }
});

test("closed DTO accepts both observed capacity states and native large total-page metadata", () => {
  const partialCapacity = OWNER_SUNO_EXISTING_TRACK_TOOL_OUTPUT_SCHEMA.safeParse({
    status: "AVAILABLE", page: 1, page_size: 20, total_count: 50_000, total_pages: 2_500,
    has_next: true, has_previous: false, unavailable_reason: "TRACK_INPUT_CAPACITY_REACHED",
    tracks: [{ track_handle: "track_12345678-1234-1234-1234-123456789abc", model_id: "V6",
      expires_in_seconds: 900, artifact: { url: ARTIFACT_URL, mime_type: "audio/mpeg" } }]
  });
  assert.equal(partialCapacity.success, true);
  const emptyCapacity = OWNER_SUNO_EXISTING_TRACK_TOOL_OUTPUT_SCHEMA.safeParse({
    status: "UNAVAILABLE", page: 1, page_size: 20, total_count: 50_000, total_pages: 2_500,
    has_next: true, has_previous: false, unavailable_reason: "TRACK_INPUT_CAPACITY_REACHED", tracks: []
  });
  assert.equal(emptyCapacity.success, true);
  const invalid = OWNER_SUNO_EXISTING_TRACK_TOOL_OUTPUT_SCHEMA.safeParse({
    status: "AVAILABLE", page: 1, page_size: 20, total_count: 1, total_pages: 1,
    has_next: false, has_previous: false, tracks: [], provider_clip_id: CLIP
  });
  assert.equal(invalid.success, false);
});

test("typed service errors are closed and do not expose untrusted upstream details", async () => {
  const harness = makeHarness({ failHistory: true });
  const connection = await connect(harness.runtime, "existing-suno-redaction-1329");
  try {
    await linkAttempt(harness.runtime, ATTEMPT, Date.parse("2026-10-14T00:00:00.000Z"));
    const result = await connection.client.callTool({ name: SYNTX_OWNER_LIST_EXISTING_SUNO_TRACKS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, true);
    assert.match(errorText(result), /HISTORY_UNAVAILABLE/u);
    assert.equal(errorText(result).includes(CLIP), false);
    assert.equal(harness.events.filter((event) => event.startsWith("POST ")).length, 0);
  } finally {
    await connection.close();
    await harness.runtime.ownerSunoGenerationLifecycle?.close();
  }
});
