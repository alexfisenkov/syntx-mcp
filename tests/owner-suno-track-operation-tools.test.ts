import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_SUNO_TRACK_OPERATION_TOOL_INPUT_SCHEMAS,
  OWNER_SUNO_TRACK_OPERATION_TOOL_NAMES,
  SYNTX_GET_SUNO_TRACK_OPERATION_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_COVER_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SUNO_TRACK_OPERATION_TOOL_NAME
} from "../src/mcp/owner-suno-track-operation-tools.js";
import { SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME } from "../src/mcp/owner-suno-generation-tools.js";
import { SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME } from "../src/mcp/owner-suno-track-tools.js";

const ATTEMPT = "link_suno_track_operation_sdk_0123456789";
const TOOL_NAMES = [
  "syntx_get_suno_track_operation_parameters",
  "syntx_owner_cover_suno_audio",
  "syntx_owner_extend_suno_audio",
  "syntx_owner_reconcile_suno_track_operation",
  "syntx_owner_list_suno_track_operation_recoveries",
  "syntx_owner_get_suno_track_operation_result_page"
] as const;

async function linkAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string, now: number): Promise<void> {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: now + 24 * 60 * 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
  await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
  await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-owner-credential" });
}

function structured(result: unknown): Record<string, unknown> {
  assert.ok(result && typeof result === "object");
  const content = (result as Record<string, unknown>).structuredContent;
  assert.ok(content && typeof content === "object");
  return content as Record<string, unknown>;
}

test("Suno track-operation MCP exports six owner tools and strict fixed-mode inputs", () => {
  assert.deepEqual(OWNER_SUNO_TRACK_OPERATION_TOOL_NAMES, TOOL_NAMES);
  const cover = OWNER_SUNO_TRACK_OPERATION_TOOL_INPUT_SCHEMAS.cover;
  const extend = OWNER_SUNO_TRACK_OPERATION_TOOL_INPUT_SCHEMAS.extend;
  const base = { link_attempt_id: ATTEMPT, model_id: "V6", track_handle: `track_00000000-0000-4000-8000-000000000001`,
    prompt: "Переосмыслить мелодию 🎵", is_custom_mode: true, is_instrumental: false,
    negative_tags: "noise", styles: "ambient", title: "Новая версия" };
  assert.equal(cover.safeParse(base).success, true);
  assert.equal(extend.safeParse({ ...base, continue_at: 12.3 }).success, true);
  for (const invalid of [
    { ...base, mode: "extend" }, { ...base, continue_at: 12 }, { ...base, file_urls: [] },
    { ...base, source_clip_id: "foreign" }, { ...base, source_task_id: "foreign" },
    { ...base, source_url: "https://example.invalid/audio.mp3" }, { ...base, cost: 0 }
  ]) assert.equal(cover.safeParse(invalid).success, false);
  for (const invalid of [
    { ...base, mode: "cover", continue_at: 12.3 }, { ...base, continue_at: -0.1 }, { ...base, continue_at: 12.35 },
    { ...base, continue_at: Number.POSITIVE_INFINITY }, { ...base, model_id: "V7" }, { ...base, prompt: "   " }
  ]) assert.equal(extend.safeParse(invalid).success, false);
  assert.equal(OWNER_SUNO_TRACK_OPERATION_TOOL_INPUT_SCHEMAS.parameters.safeParse({ unexpected: true }).success, false);
});

test("stock SDK keeps six operation tools default-off and owner opt-in preserves the existing Suno surface", async () => {
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("unexpected startup request"); } });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "suno-track-operation-default-off", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (OWNER_SUNO_TRACK_OPERATION_TOOL_NAMES as readonly string[]).includes(name)), false);
    assert.equal(names.includes(SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME), false);
    assert.equal(names.includes(SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME), false);
    assert.equal(names.includes(SYNTX_GET_SUNO_TRACK_OPERATION_PARAMETERS_TOOL_NAME), false);
  } finally { await client.close(); await server.close(); }
});

test("genuine SDK runs base Suno, lists an opaque track, dispatches cover and extend once, then GET-reconciles", async () => {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const counts = { account: 0, model: 0, chats: 0, posts: 0, history: 0, results: 0 };
  const jobs = new Map<string, { prompt: string; model: string; ack: string; operation: string; sourceClip: string; sourceTask: string }>();
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  let loseExtendAck = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ method, path: url.pathname, ...(body === undefined ? {} : { body }) });
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.account += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.account += 1; return Response.json({ active: true, type: "PRO", end_date: new Date(now + 86_400_000).toISOString() });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.model += 1; return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; return Response.json({ uuid: `suno-operation-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.posts += 1;
      const settings = body?.settings as Record<string, unknown>;
      const chat = String(body?.chat_uuid);
      const prompt = String(body?.prompt);
      const ack = `suno-operation-ack-${counts.posts}`;
      jobs.set(chat, { prompt, model: String(settings.model_type), ack,
        operation: String(settings.mode), sourceClip: String(settings.source_clip_id ?? ""), sourceTask: String(settings.source_task_id ?? "") });
      if (loseExtendAck && settings.mode === "extend") { loseExtendAck = false; throw new Error("Synthetic lost POST acknowledgement."); }
      return Response.json({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.history += 1;
      const job = jobs.get(history[1]!); assert.ok(job);
      const messages = [
        { id: job.ack, chat_id: 9173, author_id: 42, message_object: [{ id: `ack-object-${job.ack}`, message_id: job.ack,
          object_type: "text", object_text: job.prompt, model_type: job.model }] },
        { id: `suno-operation-bot-${job.ack}`, chat_id: 9173, author_id: -1, message_object: [{
          id: `audio-object-${job.ack}`, message_id: `suno-operation-bot-${job.ack}`, object_type: "audio", model_type: job.model
        }] }
      ];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      counts.results += 1;
      const job = jobs.get(result[1]!); assert.ok(job);
      return Response.json({ id: result[2], chat_id: 9173, author_id: -1, message_object: [{
        id: `audio-object-${job.ack}`, message_id: result[2], object_type: "audio", object_url: "https://r2.syntx.ai/generated/suno-operation.mp3",
        completed: true, model_type: job.model, metadata: { payload: { clip_id: job.sourceClip || `base-clip-${counts.posts}`,
          task_id: job.sourceTask || `base-task-${counts.posts}` } }
      }] });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };

  const runtime = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl, now: () => now });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "suno-track-operation-stock-sdk", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await linkAttempt(runtime, ATTEMPT, now);
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const registered = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(registered.filter((name) => (OWNER_SUNO_TRACK_OPERATION_TOOL_NAMES as readonly string[]).includes(name)), TOOL_NAMES);
    const profile = await client.callTool({ name: SYNTX_GET_SUNO_TRACK_OPERATION_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(structured(profile).dispatch_allowed, false);
    assert.equal(counts.posts, 0);

    const base = await client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "V6", mode: "generate", prompt: "Исходный трек",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "ambient", title: "Источник"
    } });
    assert.equal(base.isError, undefined, JSON.stringify(base));
    const baseOutput = structured(base);
    const tracksResult = await client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: String(baseOutput.recovery_id)
    } });
    assert.equal(tracksResult.isError, undefined, JSON.stringify(tracksResult));
    const track = (structured(tracksResult).tracks as Array<{ track_handle: string; model_id: string }>)[0];
    assert.ok(track);
    assert.ok(track.track_handle.startsWith("track_")); assert.equal(track.model_id, "V6");

    const coverInput = { link_attempt_id: ATTEMPT, model_id: "V6", track_handle: track.track_handle, prompt: "Обложка 🎵",
      is_custom_mode: true, is_instrumental: false, negative_tags: "noise", styles: "ambient", title: "Кавер" };
    const foreign = await client.callTool({ name: SYNTX_OWNER_COVER_SUNO_AUDIO_TOOL_NAME, arguments: { ...coverInput, model_id: "V6_wild" } });
    assert.equal(foreign.isError, true);
    assert.equal(counts.posts, 1, "foreign model binding is rejected before another paid POST");
    const cover = await client.callTool({ name: SYNTX_OWNER_COVER_SUNO_AUDIO_TOOL_NAME, arguments: coverInput });
    assert.equal(cover.isError, undefined, JSON.stringify(cover));
    const coverOutput = structured(cover);
    assert.equal((coverOutput.artifacts as unknown[]).length, 1);
    const beforeCachedPage = { ...counts };
    const page = await client.callTool({ name: SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: String(coverOutput.recovery_id)
    } });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    assert.equal((structured(page).artifacts as unknown[]).length, 1);
    assert.deepEqual(counts, beforeCachedPage, "cached operation result pages make no upstream requests");

    loseExtendAck = true;
    const extend = await client.callTool({ name: SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME, arguments: { ...coverInput,
      prompt: "Продолжение 🎵", title: "Продление", continue_at: 12.3
    } });
    assert.equal(extend.isError, true);
    const extendError = JSON.parse((extend.content as Array<{ text?: string }>).find((item) => item.text)?.text ?? "{}") as {
      error?: { code?: string; recovery_id?: string }
    };
    assert.equal(extendError.error?.code, "OUTCOME_UNKNOWN");
    assert.match(extendError.error?.recovery_id ?? "", /^suno_track_operation_recovery_[0-9a-f-]{36}$/u);
    assert.equal(counts.posts, 3, "only base, cover and one extend POST were issued");
    const settings = requests.filter((request) => request.method === "POST" && request.path === "/api/v1/audio/generate")
      .map((request) => request.body?.settings as Record<string, unknown>);
    assert.deepEqual(settings[1], { model_type: "V6", mode: "cover", is_custom_mode: true, is_instrumental: false,
      negative_tags: "noise", styles: "ambient", title: "Кавер", source_clip_id: "base-clip-1", source_task_id: "base-task-1", file_urls: [] });
    assert.deepEqual(settings[2], { model_type: "V6", mode: "extend", is_custom_mode: true, is_instrumental: false,
      negative_tags: "noise", styles: "ambient", title: "Продление", source_clip_id: "base-clip-1", source_task_id: "base-task-1",
      continue_at: 12.3, file_urls: [] });
    const listedBeforeReconcile = await client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listedBeforeReconcile.isError, undefined, JSON.stringify(listedBeforeReconcile));
    assert.equal((structured(listedBeforeReconcile).recoveries as unknown[]).length, 1);
    const beforeReconcile = { ...counts };
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_SUNO_TRACK_OPERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: extendError.error!.recovery_id!
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    assert.equal((structured(reconciled).status_semantics), "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(counts.posts, beforeReconcile.posts, "reconcile never repeats the uncertain paid POST");
    assert.ok(counts.history > beforeReconcile.history);
    assert.ok(counts.results > beforeReconcile.results);

    const recoveries = await client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(recoveries.isError, undefined, JSON.stringify(recoveries));
    assert.equal((structured(recoveries).recoveries as unknown[]).length, 0, "completed reconciliation leaves no unresolved recovery");
    const noReplay = await client.callTool({ name: SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME, arguments: { ...coverInput,
      prompt: "Продолжение 🎵", title: "Продление", continue_at: 12.3
    } });
    assert.equal(noReplay.isError, undefined, JSON.stringify(noReplay));
    assert.equal(structured(noReplay).recovery_id, extendError.error?.recovery_id, "same intent returns its existing cached result");
    assert.equal(counts.posts, 3, "same semantic intent does not dispatch a second POST");

    await runtime.linkService.revoke(runtime.authBinding, ATTEMPT);
    const revokedRead = await client.callTool({ name: SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: String(coverOutput.recovery_id)
    } });
    assert.equal(revokedRead.isError, true);
    assert.equal(JSON.stringify(revokedRead).includes("r2.syntx.ai"), false, "revoked owner cannot read cached media URLs");
    assert.equal(counts.posts, 3);
  } finally {
    await client.close(); await server.close();
    await runtime.ownerSunoGenerationLifecycle?.close();
  }
});

test("genuine SDK exposes only a typed observed bot error and keeps its recovery GET-only", async () => {
  let now = Date.parse("2026-10-14T02:00:00.000Z");
  const counts = { posts: 0, history: 0, results: 0 };
  const jobs = new Map<string, { prompt: string; model: string; ack: string; isOperation: boolean; observedError: boolean }>();
  let nextOperationError = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    if (url.pathname === "/api/v1/user/balance" && method === "GET") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      return Response.json({ active: true, type: "PRO", end_date: new Date(now + 86_400_000).toISOString() });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: `suno-observed-error-chat-${counts.posts + jobs.size + 1}` });
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.posts += 1;
      const settings = body?.settings as Record<string, unknown>;
      const chat = String(body?.chat_uuid);
      const ack = `suno-observed-error-ack-${counts.posts}`;
      const isOperation = settings.mode === "cover" || settings.mode === "extend";
      const observedError = isOperation && nextOperationError;
      nextOperationError = false;
      jobs.set(chat, { prompt: String(body?.prompt), model: String(settings.model_type), ack, isOperation, observedError });
      return Response.json({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.history += 1;
      const job = jobs.get(history[1]!); assert.ok(job);
      const botId = `suno-observed-error-bot-${job.ack}`;
      const botObjects = job.observedError
        ? [1, 2].map((index) => ({ id: `${botId}-error-${index}`, message_id: botId, object_type: "error",
            model_type: job.model, object_text: "Synthetic upstream error body is intentionally inert",
            object_url: "https://example.invalid/private-error-detail", completed: false }))
        : [{ id: `${botId}-audio`, message_id: botId, object_type: "audio", model_type: job.model }];
      const messages = [
        { id: job.ack, chat_id: 9173, author_id: 42, message_object: [{ id: `${job.ack}-text`, message_id: job.ack,
          object_type: "text", object_text: job.prompt, model_type: job.model }] },
        { id: botId, chat_id: 9173, author_id: -1, message_object: botObjects }
      ];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      counts.results += 1;
      const job = jobs.get(result[1]!); assert.ok(job);
      return Response.json({ id: result[2], chat_id: 9173, author_id: -1, message_object: [{
        id: `${result[2]}-audio`, message_id: result[2], object_type: "audio",
        object_url: "https://r2.syntx.ai/generated/suno-observed-base.mp3", completed: true, model_type: job.model,
        metadata: { payload: { clip_id: "suno-observed-base-clip", task_id: "suno-observed-base-task" } }
      }] });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl, now: () => now });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "suno-observed-error-sdk", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await linkAttempt(runtime, ATTEMPT, now);
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const base = await client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "V6", mode: "generate", prompt: "Исходник для observed error",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "ambient", title: "Исходник"
    } });
    assert.equal(base.isError, undefined, JSON.stringify(base));
    const inputs = await client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_INPUTS_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: String(structured(base).recovery_id)
    } });
    const track = (structured(inputs).tracks as Array<{ track_handle: string; model_id: string }>)[0];
    assert.ok(track); assert.equal(track.model_id, "V6");
    const request = { link_attempt_id: ATTEMPT, model_id: "V6", track_handle: track.track_handle,
      prompt: "Extend с наблюдаемой ошибкой", is_custom_mode: true, is_instrumental: false,
      negative_tags: "", styles: "ambient", title: "Не повторять", continue_at: 8.4 };
    const foreignModel = await client.callTool({ name: SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME,
      arguments: { ...request, model_id: "V6_wild" } });
    assert.equal(foreignModel.isError, true);
    assert.equal(counts.posts, 1, "foreign-model row is rejected before paid dispatch");

    nextOperationError = true;
    const observed = await client.callTool({ name: SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME, arguments: request });
    assert.equal(observed.isError, true);
    const observedText = (observed.content as Array<{ text?: string }>).find((item) => item.text)?.text ?? "{}";
    const errorPayload = JSON.parse(observedText) as { error?: { code?: string; message?: string; recovery_id?: string; diagnostic?: { gaps?: string[]; owner_ack_status?: string } } };
    assert.equal(errorPayload.error?.code, "UPSTREAM_OPERATION_ERROR");
    assert.equal(errorPayload.error?.message, "SYNTX reported an operation error for this Suno request; reconcile its recovery and do not retry.");
    assert.match(errorPayload.error?.recovery_id ?? "", /^suno_track_operation_recovery_[0-9a-f-]{36}$/u);
    assert.deepEqual(errorPayload.error?.diagnostic?.gaps, ["BOT_ERROR_OBSERVED"]);
    assert.equal(errorPayload.error?.diagnostic?.owner_ack_status, "MATCHED");
    assert.equal("provider_terminal_status" in (errorPayload.error ?? {}), false, "observed bot error does not claim provider-terminal failure");
    assert.equal(observedText.includes("Synthetic upstream error body"), false);
    assert.equal(observedText.includes("private-error-detail"), false);
    assert.equal(observedText.includes("suno-observed-base-clip"), false);
    assert.equal(counts.posts, 2);
    assert.equal(counts.results, 1, "all-error history does not issue an audio result GET");

    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_SUNO_TRACK_OPERATION_RECOVERIES_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    const recovery = (structured(listed).recoveries as Array<{ recovery_id: string; status: string }>)[0];
    assert.ok(recovery); assert.equal(recovery.recovery_id, errorPayload.error?.recovery_id);
    assert.equal(recovery.status, "upstream_error_observed");

    const postsBeforeReads = counts.posts, historyBeforePage = counts.history, resultsBeforePage = counts.results;
    const page = await client.callTool({ name: SYNTX_OWNER_GET_SUNO_TRACK_OPERATION_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recovery.recovery_id
    } });
    assert.equal(page.isError, true);
    assert.match((page.content as Array<{ text?: string }>).find((item) => item.text)?.text ?? "", /UPSTREAM_OPERATION_ERROR/u);
    assert.deepEqual(counts, { posts: postsBeforeReads, history: historyBeforePage, results: resultsBeforePage },
      "result page returns the typed cached observation without HTTP");

    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_SUNO_TRACK_OPERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: recovery.recovery_id
    } });
    assert.equal(reconciled.isError, true);
    const reconcileText = (reconciled.content as Array<{ text?: string }>).find((item) => item.text)?.text ?? "";
    assert.match(reconcileText, /UPSTREAM_OPERATION_ERROR/u);
    assert.match(reconcileText, new RegExp(recovery.recovery_id));
    assert.equal(counts.posts, postsBeforeReads, "reconcile performs no generation POST");
    assert.ok(counts.history > historyBeforePage, "reconcile may refresh same-chat history by GET");
    assert.equal(counts.results, resultsBeforePage);

    const replay = await client.callTool({ name: SYNTX_OWNER_EXTEND_SUNO_AUDIO_TOOL_NAME, arguments: request });
    assert.equal(replay.isError, true);
    assert.match((replay.content as Array<{ text?: string }>).find((item) => item.text)?.text ?? "", /UPSTREAM_OPERATION_ERROR/u);
    assert.equal(counts.posts, 2, "same intent keeps the observed error non-retryable");
  } finally {
    await client.close(); await server.close();
    await runtime.ownerSunoGenerationLifecycle?.close();
  }
});
