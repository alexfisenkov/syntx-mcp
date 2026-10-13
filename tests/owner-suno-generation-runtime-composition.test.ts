import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { isOwnerSunoGenerationService } from "../src/application/owner-suno-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_SUNO_GENERATION_TOOL_NAMES,
  SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME,
  SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME
} from "../src/mcp/owner-suno-generation-tools.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerSunoGenerationFlag } from "../src/transports/stdio-owner.js";

interface SyntheticAudioObject { readonly id: string; readonly url: string; }
interface SyntheticBotRow { readonly id: string; readonly objects: readonly SyntheticAudioObject[]; }
interface SyntheticJob {
  readonly prompt: string;
  readonly model: string;
  readonly ack: string;
  readonly rows: readonly SyntheticBotRow[];
}

function pendingBarrier(events: string[], attemptId: string) {
  let started!: () => void;
  let aborted!: () => void;
  let abortPromiseSettled = false;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const abortedPromise = new Promise<void>((resolve) => { aborted = resolve; });
  return {
    started: startedPromise,
    aborted: abortedPromise,
    attemptId,
    markStarted() { events.push(`post.started:${attemptId}`); started(); },
    markAborted() { if (!abortPromiseSettled) { abortPromiseSettled = true; events.push(`post.aborted:${attemptId}`); aborted(); } }
  };
}

async function linkAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string, now: number): Promise<void> {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: now + 24 * 60 * 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
  await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
  await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-suno-runtime-credential" });
}

function structured(result: unknown): Record<string, unknown> {
  assert.ok(result && typeof result === "object");
  const content = (result as Record<string, unknown>).structuredContent;
  assert.ok(content && typeof content === "object");
  return content as Record<string, unknown>;
}

test("Suno runtime flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerSunoGenerationFlag(value), false);
  assert.equal(readOwnerSunoGenerationFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerSunoGenerationFlag(value), /Invalid SYNTX_OWNER_SUNO_GENERATION configuration/u);
  }
});

test("Suno runtime composes only on opt-in and does no startup network I/O", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaults.serverOptions.ownerSunoGeneration, undefined);
  assert.equal(defaults.ownerSunoGenerationLifecycle, undefined);

  const enabled = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl });
  assert.ok(enabled.serverOptions.ownerSunoGeneration);
  assert.equal(isOwnerSunoGenerationService(enabled.serverOptions.ownerSunoGeneration.generationService), true);
  assert.ok(enabled.ownerSunoGenerationLifecycle);
  assert.equal(fetchCalls, 0);
  await enabled.ownerSunoGenerationLifecycle.close();
});

test("Stock SDK exposes five opt-in Suno tools, preserves eight explicit intents, caches 80 audio objects, and GET-reconciles after TTL", async () => {
  let now = Date.parse("2026-10-13T04:00:00.000Z");
  const counts = { account: 0, model: 0, chats: 0, posts: 0, history: 0, results: 0 };
  const jobs = new Map<string, SyntheticJob>();
  let makeLargeResult = false;
  let loseNextAck = false;
  let nextPending: ReturnType<typeof pendingBarrier> | undefined;
  const events: string[] = [];
  const postedSettings: Array<Record<string, unknown>> = [];
  let runtime: ReturnType<typeof createObservedOwnerRuntime>;
  const audioRows = (postNumber: number, count: number): readonly SyntheticBotRow[] => {
    const sizes = count === 80 ? [64, 16] : [count];
    let offset = 0;
    return Object.freeze(sizes.map((size, rowIndex) => {
      const messageId = `suno-runtime-bot-${postNumber}-${rowIndex + 1}`;
      const objects = Object.freeze(Array.from({ length: size }, (_, index) => {
        const sequence = offset + index + 1;
        return Object.freeze({ id: `suno-runtime-object-${postNumber}-${sequence}`,
          url: `https://r2.syntx.ai/generated/suno-runtime-${postNumber}-${sequence}.mp3` });
      }));
      offset += size;
      return Object.freeze({ id: messageId, objects });
    }));
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      counts.account += 1;
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.account += 1;
      return Response.json({ active: true, type: "PRO", end_date: new Date(now + 24 * 60 * 60_000).toISOString() });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.model += 1;
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1;
      return Response.json({ uuid: `suno-runtime-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.posts += 1;
      const request = body as { readonly chat_uuid: string; readonly prompt: string;
        readonly settings: Record<string, unknown> & { readonly model_type: string } };
      postedSettings.push(Object.freeze({ ...request.settings }));
      const ack = `suno-runtime-ack-${counts.posts}`;
      const rows = audioRows(counts.posts, makeLargeResult ? 80 : 1);
      makeLargeResult = false;
      jobs.set(request.chat_uuid, Object.freeze({ prompt: request.prompt, model: request.settings.model_type, ack, rows }));
      if (nextPending !== undefined) {
        const barrier = nextPending;
        nextPending = undefined;
        barrier.markStarted();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          assert.ok(signal, "Suno generation POST must receive an abort signal");
          signal.addEventListener("abort", async () => {
            const status = await runtime.authStore.getSnapshot(runtime.authBinding, barrier.attemptId);
            events.push(`credential.status.${barrier.attemptId}.${status.status}`);
            barrier.markAborted();
            reject(new DOMException("Synthetic lifecycle drain abort.", "AbortError"));
          }, { once: true });
        });
      }
      if (loseNextAck) {
        loseNextAck = false;
        throw new Error("Synthetic lost Suno POST response after dispatch start");
      }
      return Response.json({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.history += 1;
      const job = jobs.get(history[1]!);
      assert.ok(job);
      const messages = [
        { id: job.ack, chat_id: 9173, author_id: 42,
          message_object: [{ id: `ack-object-${job.ack}`, message_id: job.ack, object_type: "text",
            object_text: job.prompt, model_type: job.model }] },
        ...job.rows.map((row) => ({ id: row.id, chat_id: 9173, author_id: -1,
          message_object: row.objects.map((object) => ({ id: object.id, message_id: row.id, object_type: "audio",
            model_type: job.model })) }))
      ];
      const page = Number(url.searchParams.get("page"));
      const pageSize = 10;
      const totalPages = Math.ceil(messages.length / pageSize);
      return Response.json({ messages: messages.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, page_size: pageSize, total_count: messages.length, total_pages: totalPages,
          has_next: page < totalPages, has_previous: page > 1 } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      counts.results += 1;
      const job = jobs.get(result[1]!);
      assert.ok(job);
      const row = job.rows.find((candidate) => candidate.id === result[2]);
      assert.ok(row);
      return Response.json({ id: row.id, chat_id: 9173, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.id, object_type: "audio",
          object_url: object.url, completed: true, model_type: job.model, metadata: { duration: 11.25, task_id: "inert" } })) });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };

  const defaults = createObservedOwnerRuntime({ fetchImpl, now: () => now });
  const defaultServer = createMcpServer(defaults.application, defaults.serverOptions);
  const defaultClient = new Client({ name: "suno-runtime-default-sdk-test", version: "1" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await defaultServer.connect(defaultServerTransport);
    await defaultClient.connect(defaultClientTransport);
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.filter((name) => (OWNER_SUNO_GENERATION_TOOL_NAMES as readonly string[]).includes(name)).length, 0);
    assert.deepEqual(counts, { account: 0, model: 0, chats: 0, posts: 0, history: 0, results: 0 });
  } finally { await defaultClient.close(); await defaultServer.close(); }

  runtime = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl, now: () => now });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "suno-runtime-opt-in-sdk-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const attemptId = "link_suno_runtime_matrix_0123456789";
  try {
    await linkAttempt(runtime, attemptId, now);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_SUNO_GENERATION_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_SUNO_GENERATION_TOOL_NAMES].sort());
    assert.equal(counts.posts, 0, "tool registration and startup must not dispatch generation");

    let largeRecovery = "";
    for (const model_id of ["V6", "V6_wild"] as const) {
      for (const is_custom_mode of [false, true]) {
        for (const is_instrumental of [false, true]) {
          const prompt = `Synthetic runtime Suno ${model_id} ${is_custom_mode} ${is_instrumental}`;
          if (model_id === "V6" && !is_custom_mode && !is_instrumental) makeLargeResult = true;
          const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
            link_attempt_id: attemptId, model_id, mode: "generate", prompt,
            is_custom_mode, is_instrumental, negative_tags: "", styles: "minimal", title: "Synthetic runtime test"
          } });
          assert.equal(result.isError, undefined);
          const output = structured(result);
          assert.equal(output.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
          assert.equal(output.backend_acceptance, "UNPROVEN");
          assert.equal(output.provider_terminal_status, "UNPROVEN");
          assert.equal((output.parameters as Record<string, unknown>).is_custom_mode, is_custom_mode);
          assert.equal((output.parameters as Record<string, unknown>).is_instrumental, is_instrumental);
          if (model_id === "V6" && !is_custom_mode && !is_instrumental) {
            assert.equal(output.observed_artifact_count, 80);
            largeRecovery = String(output.recovery_id);
          } else assert.equal(output.observed_artifact_count, 1);
        }
      }
    }
    const historyBeforePage = counts.history, resultsBeforePage = counts.results;
    const firstPage = await client.callTool({ name: SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME,
      arguments: { link_attempt_id: attemptId, recovery_id: largeRecovery } });
    const secondPage = await client.callTool({ name: SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME,
      arguments: { link_attempt_id: attemptId, recovery_id: largeRecovery, offset: 64 } });
    assert.equal((structured(firstPage).artifacts as unknown[]).length, 64);
    assert.equal((structured(secondPage).artifacts as unknown[]).length, 16);
    assert.equal(counts.history, historyBeforePage, "cached result page must not reread provider history");
    assert.equal(counts.results, resultsBeforePage, "cached result page must not issue a provider GET");
    assert.deepEqual(counts, { account: 32, model: 16, chats: 8, posts: 8, history: 8, results: 9 });
    assert.deepEqual(postedSettings.slice(0, 8).map(({ model_type, mode, is_custom_mode, is_instrumental, file_urls }) =>
      ({ model_type, mode, is_custom_mode, is_instrumental, file_urls })), [
      ...["V6", "V6_wild"].flatMap((model_type) => [false, true].flatMap((is_custom_mode) => [false, true].map((is_instrumental) => ({
        model_type, mode: "generate", is_custom_mode, is_instrumental, file_urls: []
      }))))
    ]);

    const lostAttempt = "link_suno_runtime_lost_ack_0123456789";
    await linkAttempt(runtime, lostAttempt, now);
    loseNextAck = true;
    const lost = await client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
      link_attempt_id: lostAttempt, model_id: "V6_wild", mode: "generate", prompt: "Synthetic lost ACK Suno intent",
      is_custom_mode: false, is_instrumental: true, negative_tags: "", styles: "minimal", title: "Lost ACK"
    } });
    assert.equal(lost.isError, true);
    const recoveries = await client.callTool({ name: SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME,
      arguments: { link_attempt_id: lostAttempt } });
    const recovery = (structured(recoveries).recoveries as Array<Record<string, unknown>>)[0];
    assert.ok(recovery?.recovery_id);
    now += 16 * 60_000;
    const postsBeforeReconcile = counts.posts;
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME,
      arguments: { link_attempt_id: lostAttempt, recovery_id: recovery.recovery_id } });
    assert.equal(reconciled.isError, undefined);
    assert.equal(structured(reconciled).backend_acceptance, "UNPROVEN");
    assert.equal(counts.posts, postsBeforeReconcile, "expired input candidate must not cause replay");
    assert.equal(counts.history, 9);
    assert.equal(counts.results, 10);

    const revokeAttempt = "link_suno_runtime_revoke_0123456789";
    await linkAttempt(runtime, revokeAttempt, now);
    const revokeBarrier = pendingBarrier(events, revokeAttempt);
    nextPending = revokeBarrier;
    const pendingRevoke = client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
      link_attempt_id: revokeAttempt, model_id: "V6", mode: "generate", prompt: "Synthetic pending Suno POST before revoke",
      is_custom_mode: false, is_instrumental: true, negative_tags: "", styles: "minimal", title: "Revoke pending"
    } });
    await revokeBarrier.started;
    await runtime.serverOptions.auth!.linkService.revoke(runtime.authBinding, revokeAttempt);
    await revokeBarrier.aborted;
    assert.equal((await pendingRevoke).isError, true);
    assert.ok(events.indexOf(`credential.status.${revokeAttempt}.LINKED`) < events.indexOf(`post.aborted:${revokeAttempt}`));
    assert.equal((await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttempt)).status, "REVOKED");

    const eofAttempt = "link_suno_runtime_eof_0123456789";
    await linkAttempt(runtime, eofAttempt, now);
    const eofBarrier = pendingBarrier(events, eofAttempt);
    nextPending = eofBarrier;
    const pendingEof = client.callTool({ name: SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME, arguments: {
      link_attempt_id: eofAttempt, model_id: "V6_wild", mode: "generate", prompt: "Synthetic pending Suno POST before EOF",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "ambient", title: "EOF pending"
    } });
    await eofBarrier.started;
    const input = new PassThrough();
    const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
    const eofClose = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
      () => events.push("owner-auth.release"), input,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      true, undefined, undefined, undefined, undefined,
      runtime.ownerSunoGenerationLifecycle);
    await eofClose();
    await eofBarrier.aborted;
    assert.equal((await pendingEof).isError, true);
    assert.ok(events.indexOf(`post.aborted:${eofAttempt}`) < events.indexOf("owner-auth.release"));
    input.destroy();
  } finally {
    await client.close();
    await server.close();
    await runtime.ownerSunoGenerationLifecycle?.close();
    runtime.authStore.close?.();
  }
});

test("Suno EOF drain completes before owner-auth release callback", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const lifecycle = { async close() { events.push("suno.close.start"); await Promise.resolve(); events.push("suno.close.done"); } };
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const args: Parameters<typeof closeOwnerReadServicesOnTransportEof> = [
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("owner-auth.release"); }, input,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    true, undefined, undefined, undefined, undefined,
    lifecycle
  ];
  const close = closeOwnerReadServicesOnTransportEof(...args);
  await close();
  assert.deepEqual(events, ["suno.close.start", "suno.close.done", "owner-auth.release"]);
  input.destroy();
});
