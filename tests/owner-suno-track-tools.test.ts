import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_SUNO_GENERATION_TOOL_NAMES,
  SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME
} from "../src/mcp/owner-suno-generation-tools.js";
import { SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME } from "../src/mcp/owner-suno-track-tools.js";

const ATTEMPT = "link_suno_track_mcp_owner_0123456789";
const OTHER_ATTEMPT = "link_suno_track_mcp_other_0123456789";
const TRACK_SENTINELS = ["private-clip-1292", "private-task-1292", "private-chat-1292", "private-object-1292"];

function makeHarness() {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    events.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/v1/user/balance" && method === "GET") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") return Response.json({ active: true,
      type: "PRO", end_date: "2026-10-15T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") return Response.json({ access: true, cost: 1,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "private-chat-1292" });
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") return Response.json({ id: "private-ack-1292" });
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") return Response.json({ messages: [
      { id: "private-ack-1292", chat_id: 9173, author_id: 42, message_object: [{ id: "ack-object-1292",
        message_id: "private-ack-1292", object_type: "text", object_text: "Synthetic Suno prompt", model_type: "V6" }] },
      { id: "private-bot-message-1292", chat_id: 9173, author_id: -1, message_object: [{ id: "private-object-1292",
        message_id: "private-bot-message-1292", object_type: "audio", model_type: "V6" }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") return Response.json({ id: result[2], chat_id: 9173, author_id: -1,
      message_object: [{ id: "private-object-1292", message_id: result[2], object_type: "audio",
        object_url: "https://r2.syntx.ai/generated/private-result-1292.mp3", completed: true, model_type: "V6",
        metadata: { payload: { clip_id: "private-clip-1292", task_id: "private-task-1292" } } }] });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl, now: () => now });
  return { runtime, events, advance(ms: number) { now += ms; } };
}

async function linkAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string, now: number): Promise<void> {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: now + 24 * 60 * 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
  await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
  await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

async function connect(runtime: ReturnType<typeof createObservedOwnerRuntime>, name: string) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, close: async () => { await Promise.all([client.close(), server.close()]); } };
}

function toolErrorText(result: unknown): string {
  assert.ok(result && typeof result === "object");
  const content = (result as { content?: readonly { type: string; text?: string }[] }).content ?? [];
  return content.find((item) => item.type === "text")?.text ?? "";
}

test("Suno track-input tool is default-off and registered exactly once with the trusted opt-in service", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error("startup must not fetch"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  const defaultConnection = await connect(defaults, "suno-track-default-off-sdk-test");
  try {
    const names = (await defaultConnection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.includes(SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME), false);
    assert.equal(calls, 0);
  } finally {
    await defaultConnection.close();
    await defaults.ownerSunoGenerationLifecycle?.close();
  }

  const configured = makeHarness();
  const now = Date.parse("2026-10-14T00:00:00.000Z");
  const connection = await connect(configured.runtime, "suno-track-opt-in-sdk-test");
  try {
    const names = (await connection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.filter((name) => name === SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME).length, 1);
    assert.deepEqual(names.filter((name) => (OWNER_SUNO_GENERATION_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_SUNO_GENERATION_TOOL_NAMES].sort());
    assert.equal(configured.events.length, 0, "trusted service verification and tool registration do not call getters or network");
    await linkAttempt(configured.runtime, ATTEMPT, now);
    await linkAttempt(configured.runtime, OTHER_ATTEMPT, now);
  } finally {
    await connection.close();
    await configured.runtime.ownerSunoGenerationLifecycle?.close();
  }
});

test("Suno track-input SDK call returns only validated opaque handles without upstream work", async () => {
  const harness = makeHarness();
  const connection = await connect(harness.runtime, "suno-track-input-sdk-test");
  const now = Date.parse("2026-10-14T00:00:00.000Z");
  try {
    await linkAttempt(harness.runtime, ATTEMPT, now);
    const generated = await connection.client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "V6", mode: "generate", prompt: "Synthetic Suno prompt",
      is_custom_mode: false, is_instrumental: true, negative_tags: "", styles: "", title: "Synthetic track"
    } });
    assert.equal(generated.isError, undefined, toolErrorText(generated));
    const recovery_id = (generated.structuredContent as { recovery_id: string }).recovery_id;
    assert.match(recovery_id, /^suno_generation_recovery_[0-9a-f-]{36}$/u);
    const before = [...harness.events];
    const listed = await connection.client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id } });
    assert.equal(listed.isError, undefined, toolErrorText(listed));
    const output = listed.structuredContent as Record<string, unknown>;
    assert.deepEqual(Object.keys(output).sort(), ["recovery_id", "status", "tracks"]);
    assert.equal(output.recovery_id, recovery_id);
    assert.equal(output.status, "AVAILABLE");
    assert.equal(harness.events.length, before.length, "listing existing handles must not cause HTTP or generation");
    const tracks = output.tracks as readonly Record<string, unknown>[];
    assert.equal(tracks.length, 1);
    assert.deepEqual(Object.keys(tracks[0]!).sort(), ["expires_in_seconds", "model_id", "track_handle"]);
    assert.match(String(tracks[0]!.track_handle), /^track_[0-9a-f-]{36}$/u);
    assert.equal(tracks[0]!.model_id, "V6");
    assert.ok(Number.isInteger(tracks[0]!.expires_in_seconds) && Number(tracks[0]!.expires_in_seconds) >= 1 &&
      Number(tracks[0]!.expires_in_seconds) <= 1_800);
    const serialized = JSON.stringify(output);
    for (const sentinel of [...TRACK_SENTINELS, "private-result-1292.mp3", "Synthetic Suno prompt", "private-bot-message-1292"]) {
      assert.equal(serialized.includes(sentinel), false, `MCP output must not expose ${sentinel}`);
    }

    for (const arguments_ of [
      { link_attempt_id: "bad-attempt", recovery_id },
      { link_attempt_id: ATTEMPT, recovery_id, unexpected: true },
      { link_attempt_id: ATTEMPT, recovery_id: "not-a-recovery" }
    ]) {
      const invalid = await connection.client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME, arguments: arguments_ });
      assert.equal(invalid.isError, true);
      assert.equal(harness.events.length, before.length, "strict input rejection must be side-effect free");
    }

    await linkAttempt(harness.runtime, OTHER_ATTEMPT, now);
    const foreign = await connection.client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME,
      arguments: { link_attempt_id: OTHER_ATTEMPT, recovery_id } });
    assert.equal(foreign.isError, true);
    const foreignError = toolErrorText(foreign);
    assert.match(foreignError, /RECOVERY_NOT_FOUND/u);
    assert.equal(foreignError.includes(recovery_id), false);
    assert.equal(harness.events.length, before.length);

    const auth = harness.runtime.serverOptions.auth as { linkService: { revoke(binding: unknown, attemptId: string): Promise<unknown> } };
    await auth.linkService.revoke(harness.runtime.authBinding, ATTEMPT);
    const revoked = await connection.client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id } });
    assert.equal(revoked.isError, true);
    const revokedError = toolErrorText(revoked);
    assert.match(revokedError, /PRINCIPAL_NOT_LINKED|RECOVERY_NOT_FOUND/u);
    assert.equal(revokedError.includes(recovery_id), false);
    assert.equal(harness.events.length, before.length);
  } finally {
    await connection.close();
    await harness.runtime.ownerSunoGenerationLifecycle?.close();
  }
});
