import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { isOwnerElevenLabsTtsGenerationService } from "../src/application/owner-elevenlabs-tts-generation-service.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_ELEVENLABS_TTS_TOOL_NAMES, SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME,
  SYNTX_OWNER_GET_ELEVENLABS_TTS_RESULT_PAGE_TOOL_NAME, SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME }
  from "../src/mcp/owner-elevenlabs-tts-tools.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerElevenLabsTtsFlag, runObservedOwnerStdioServer }
  from "../src/transports/stdio-owner.js";

async function readTtsFlag(value: string | undefined): Promise<boolean> {
  return readOwnerElevenLabsTtsFlag(value);
}

test("ElevenLabs TTS stdio flag is strict and default-off", async () => {
  for (const value of [undefined, "", "0"]) assert.equal(await readTtsFlag(value), false);
  assert.equal(await readTtsFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    await assert.rejects(readTtsFlag(value), /Invalid SYNTX_OWNER_ELEVENLABS_TTS configuration/u);
  }
});

test("runtime default is service-free, and exact opt-in composes actual TTS and borrowed voice services without startup I/O", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(Reflect.get(defaults.serverOptions, "ownerElevenLabsTts"), undefined);
  assert.equal(Reflect.get(defaults, "ownerElevenLabsTtsLifecycle"), undefined);

  const enabled = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerElevenLabsTtsEnabled: true, fetchImpl }]);
  const composition = Reflect.get(enabled.serverOptions, "ownerElevenLabsTts") as Record<string, unknown> | undefined;
  assert.ok(composition, "MISSING_OWNER_ELEVENLABS_TTS_COMPOSITION");
  assert.equal(typeof composition.voiceReferenceService, "object");
  assert.equal(isOwnerElevenLabsTtsGenerationService(composition.generationService), true);
  const lifecycle = Reflect.get(enabled, "ownerElevenLabsTtsLifecycle") as { close(): Promise<void>; invalidateAttempt(id: string): Promise<void> } | undefined;
  assert.ok(lifecycle, "MISSING_OWNER_ELEVENLABS_TTS_LIFECYCLE");
  assert.equal(fetchCalls, 0, "composition must remain local and make no startup request");
  await lifecycle.close();
});

test("invalid TTS stdio flag rejects before attaching transport listeners", async () => {
  const original = process.env.SYNTX_OWNER_ELEVENLABS_TTS;
  const input = new PassThrough();
  try {
    process.env.SYNTX_OWNER_ELEVENLABS_TTS = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_ELEVENLABS_TTS configuration/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    if (original === undefined) delete process.env.SYNTX_OWNER_ELEVENLABS_TTS;
    else process.env.SYNTX_OWNER_ELEVENLABS_TTS = original;
  }
});

function linkedAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string): Promise<void> {
  return (async () => {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
    await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-${attemptId}`);
    await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
    await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  })();
}

test("Stock SDK exposes the six ElevenLabs TTS tools only on opt-in and pages all four source models plus 80 observed audios", async () => {
  const counts = { voice: 0, account: 0, model: 0, chats: 0, posts: 0, history: 0, results: 0 };
  let blockNextPost = false;
  let markPendingPostStarted!: () => void;
  let markPendingPostAborted!: () => void;
  const pendingPostStarted = new Promise<void>((resolve) => { markPendingPostStarted = resolve; });
  const pendingPostAborted = new Promise<void>((resolve) => { markPendingPostAborted = resolve; });
  let linkedBeforeAbort: string | undefined;
  const jobs = new Map<string, { readonly prompt: string; readonly model: string; readonly ack: string;
    readonly rows: readonly { readonly id: string; readonly objects: readonly { readonly id: string; readonly url: string }[] }[] }>();
  const revokeAttemptId = "link_runtime_elevenlabs_tts_revoke_0123456789";
  let runtime: ReturnType<typeof createObservedOwnerRuntime>;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    if (url.pathname === "/api/v1/audio/elevenlabs/voice_examples" && method === "GET") {
      counts.voice += 1;
      return Response.json([{ voice_id: "synthetic_runtime_voice", name: "Synthetic runtime voice" }]);
    }
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.account += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.account += 1;
      return Response.json({ active: true, type: "PRO", end_date: new Date(Date.now() + 24 * 60 * 60_000).toISOString() });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.model += 1;
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1;
      const uuid = `runtime-elevenlabs-chat-${counts.chats}`;
      return Response.json({ uuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.posts += 1;
      const inputBody = body as { readonly chat_uuid: string; readonly prompt: string;
        readonly settings: { readonly model_type: string } };
      const model = inputBody.settings.model_type;
      const ack = `runtime-elevenlabs-ack-${counts.posts}`;
      if (blockNextPost) {
        blockNextPost = false;
        markPendingPostStarted();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          assert.ok(signal, "the TTS audio POST must receive an abort signal");
          signal.addEventListener("abort", async () => {
            linkedBeforeAbort = (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status;
            markPendingPostAborted();
            reject(new DOMException("Synthetic revoke abort.", "AbortError"));
          }, { once: true });
        });
      }
      const count = model === "eleven_v4_turbo" ? 80 : 1;
      const rows = Array.from({ length: Math.ceil(count / 64) }, (_, rowIndex) => {
        const offset = rowIndex * 64;
        const size = Math.min(64, count - offset);
        const id = `runtime-elevenlabs-bot-${counts.posts}-${rowIndex + 1}`;
        return Object.freeze({ id, objects: Object.freeze(Array.from({ length: size }, (_, index) => {
          const number = offset + index + 1;
          return Object.freeze({ id: `runtime-elevenlabs-object-${counts.posts}-${number}`,
            url: `https://r2.syntx.ai/generated/runtime-tts-${counts.posts}-${number}.mp3` });
        })) });
      });
      jobs.set(inputBody.chat_uuid, Object.freeze({ prompt: inputBody.prompt, model, ack, rows: Object.freeze(rows) }));
      return Response.json({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.history += 1;
      const job = jobs.get(history[1]!);
      assert.ok(job);
      const messages: Array<Record<string, unknown>> = [{ id: job.ack, chat_id: 9173, author_id: 11,
        message_object: [{ id: `ack-${job.ack}`, message_id: job.ack, object_type: "text", object_text: job.prompt, model_type: job.model }] },
      ...job.rows.map((row) => ({ id: row.id, chat_id: 9173, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.id, object_type: "audio", model_type: job.model })) }))];
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
      const row = job.rows.find((item) => item.id === result[2]);
      assert.ok(row);
      return Response.json({ id: row.id, chat_id: 9173, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.id, object_type: "audio",
          object_url: object.url, completed: true, model_type: job.model })) });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };

  const defaults = createObservedOwnerRuntime({ fetchImpl });
  const defaultServer = createMcpServer(defaults.application, defaults.serverOptions);
  const defaultClient = new Client({ name: "elevenlabs-tts-default-sdk-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await defaultServer.connect(defaultServerTransport);
    await defaultClient.connect(defaultClientTransport);
    const defaultNames = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(defaultNames.some((name) => (OWNER_ELEVENLABS_TTS_TOOL_NAMES as readonly string[]).includes(name)), false);
  } finally { await defaultClient.close(); await defaultServer.close(); }

  runtime = createObservedOwnerRuntime({ ownerElevenLabsTtsEnabled: true, fetchImpl });
  const composition = runtime.serverOptions.ownerElevenLabsTts;
  assert.ok(composition);
  const attemptId = "link_runtime_elevenlabs_tts_0123456789";
  await linkedAttempt(runtime, attemptId);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "elevenlabs-tts-runtime-sdk-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_ELEVENLABS_TTS_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_ELEVENLABS_TTS_TOOL_NAMES].sort());
    const voiceResult = await client.callTool({ name: SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME,
      arguments: { link_attempt_id: attemptId } });
    const voice = (voiceResult.structuredContent as { voices: Array<{ voice_ref: string }> }).voices[0]!;
    assert.ok(voice.voice_ref.startsWith("owner_elevenlabs_voice_"));

    const models = ["eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"] as const;
    const outputs: Array<{ recovery_id: string; observed_artifact_count: number }> = [];
    for (const model_id of models) {
      const prompt = `Runtime SDK synthetic TTS: ${model_id}`;
      const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME, arguments: {
        link_attempt_id: attemptId, model_id, mode: "text_to_speech", prompt, voice_ref: voice.voice_ref,
        stability: 0.5, similarity_boost: 0.5,
        ...(model_id === "eleven_v4" || model_id === "eleven_v4_turbo" ? { language_code: "auto" } : {})
      } });
      assert.equal(result.isError, undefined);
      const structured = result.structuredContent as { recovery_id: string; observed_artifact_count: number;
        status_semantics: string; backend_acceptance: string; provider_terminal_status: string };
      assert.equal(structured.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
      assert.equal(structured.backend_acceptance, "UNPROVEN");
      assert.equal(structured.provider_terminal_status, "UNPROVEN");
      outputs.push(structured);
    }
    assert.deepEqual(outputs.map(({ observed_artifact_count }) => observed_artifact_count), [1, 1, 1, 80]);
    const readsBeforePage = counts.results;
    const page = await client.callTool({ name: SYNTX_OWNER_GET_ELEVENLABS_TTS_RESULT_PAGE_TOOL_NAME,
      arguments: { link_attempt_id: attemptId, recovery_id: outputs[3]!.recovery_id, offset: 64 } });
    assert.equal((page.structuredContent as { artifacts: unknown[] }).artifacts.length, 16);
    assert.equal(counts.results, readsBeforePage, "cached result pages must not issue a GET");
    assert.deepEqual(counts, { voice: 1, account: 16, model: 8, chats: 4, posts: 4, history: 4, results: 5 });

    await linkedAttempt(runtime, revokeAttemptId);
    const revokeVoices = await client.callTool({ name: SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME,
      arguments: { link_attempt_id: revokeAttemptId } });
    const revokeVoice = (revokeVoices.structuredContent as { voices: Array<{ voice_ref: string }> }).voices[0]!;
    blockNextPost = true;
    const pendingGeneration = client.callTool({ name: SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME, arguments: {
      link_attempt_id: revokeAttemptId, model_id: "eleven_v4_turbo", mode: "text_to_speech",
      prompt: "Synthetic pending post for ordered revoke.", voice_ref: revokeVoice.voice_ref,
      stability: 0.5, similarity_boost: 0.5, language_code: "auto"
    } });
    await pendingPostStarted;
    const linkService = runtime.serverOptions.auth?.linkService;
    assert.ok(linkService);
    await linkService.revoke(runtime.authBinding, revokeAttemptId);
    await pendingPostAborted;
    const pendingResult = await pendingGeneration;
    assert.equal(pendingResult.isError, true);
    assert.equal(linkedBeforeAbort, "LINKED", "owner credentials stay linked until generation drains");
    assert.equal((await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status, "REVOKED");
    assert.equal(counts.posts, 5, "revoke must abort the pending post without replay");
    assert.equal(counts.history, 4, "uncertain revoked request must not continue result polling");
  } finally {
    await client.close();
    await server.close();
    await runtime.ownerElevenLabsTtsLifecycle?.close();
    runtime.authStore.close?.();
  }
});

test("TTS transport EOF drains its composed lifecycle before owner-auth release", async () => {
  const runtime = createObservedOwnerRuntime({ ownerElevenLabsTtsEnabled: true,
    fetchImpl: async () => { throw new Error("No startup request expected"); } });
  const events: string[] = [];
  const input = new PassThrough();
  const lifecycle = runtime.ownerElevenLabsTtsLifecycle;
  assert.ok(lifecycle);
  const close = closeOwnerReadServicesOnTransportEof({ onclose: undefined, async close() {} } as unknown as Transport,
    undefined, undefined, undefined, undefined, () => events.push("auth.release"), input,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    true, undefined, undefined, undefined, undefined,
    { async close() { events.push("tts.lifecycle.close.start"); await lifecycle.close(); events.push("tts.lifecycle.close.done"); } });
  await close();
  assert.deepEqual(events, ["tts.lifecycle.close.start", "tts.lifecycle.close.done", "auth.release"]);
  input.destroy();
});
