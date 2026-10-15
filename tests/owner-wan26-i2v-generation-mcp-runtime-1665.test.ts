import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { promisify } from "node:util";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const TOOL_NAMES = Object.freeze([
  "syntx_owner_get_wan26_i2v_parameters",
  "syntx_owner_upload_wan26_i2v_image",
  "syntx_owner_upload_wan26_i2v_audio",
  "syntx_owner_generate_wan26_i2v_video",
  "syntx_owner_reconcile_wan26_i2v_video",
  "syntx_owner_list_wan26_i2v_recoveries",
  "syntx_owner_get_wan26_i2v_result_page"
] as const);
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const MEDIA_PAIRS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" },
  ...(process.env.SYNTX_WAN26_I2V_TEST_FFMPEG && process.env.SYNTX_WAN26_I2V_TEST_FFPROBE
    ? [{ ffmpeg: process.env.SYNTX_WAN26_I2V_TEST_FFMPEG, ffprobe: process.env.SYNTX_WAN26_I2V_TEST_FFPROBE }]
    : [])
].find(({ ffmpeg, ffprobe }) => existsSync(ffmpeg) && existsSync(ffprobe));
const exec = promisify(execFile);
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

interface RuntimeState {
  wallNow: number;
  subscriptionActive: boolean;
  loseNextStartAck: boolean;
  pendingFirstResult: boolean;
  generationPosts: number;
  chatCreates: number;
  imageUploads: number;
  audioUploads: number;
  historyGets: number;
  resultGets: number;
  balanceReads: number;
  subscriptionReads: number;
  quoteCalls: Readonly<Record<string, string>>[];
  videoBodies: Record<string, unknown>[];
  modelsByChat: Map<string, string>;
  promptsByChat: Map<string, string>;
  acksByChat: Map<string, string>;
  historyGetsByChat: Map<string, number>;
  resultGetsByChat: Map<string, number>;
}

function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29);
  return bytes;
}

function json(value: unknown): Response { return Response.json(value); }

function page(messages: readonly unknown[]) {
  return { messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
    total_pages: messages.length === 0 ? 0 : 1, has_next: false, has_previous: false } };
}

function createState(): RuntimeState {
  return { wallNow: Date.now(), subscriptionActive: true, loseNextStartAck: false, pendingFirstResult: false,
    generationPosts: 0, chatCreates: 0, imageUploads: 0, audioUploads: 0, historyGets: 0, resultGets: 0,
    balanceReads: 0, subscriptionReads: 0, quoteCalls: [], videoBodies: [], modelsByChat: new Map(),
    promptsByChat: new Map(), acksByChat: new Map(), historyGetsByChat: new Map(), resultGetsByChat: new Map() };
}

function createSyntheticFetch(state: RuntimeState): typeof fetch {
  return async (input, init = {}) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (url.pathname === "/api/v1/auth/startauth" && method === "POST") {
      return json({ uuid: "00000000-0000-4000-8000-000000000165" });
    }
    if (url.pathname === "/api/v1/auth/token/00000000-0000-4000-8000-000000000165" && method === "GET") {
      return json({ valid: true, complete: true, token: "synthetic-wan26-runtime-token-1665", is_new_user: false });
    }
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      state.balanceReads += 1; return json({ balance: "920.5" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      state.subscriptionReads += 1;
      return json({ active: state.subscriptionActive, type: "PRO", end_date: new Date(state.wallNow + 60 * 60_000).toISOString() });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      state.quoteCalls.push(Object.freeze(Object.fromEntries(url.searchParams.entries())));
      return json({ access: true, cost: 7.5, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData, file = form.get("files");
      assert.ok(file instanceof File); assert.equal(form.get("destination"), "uploaded");
      const image = file.type.startsWith("image/");
      if (image) state.imageUploads += 1; else state.audioUploads += 1;
      return json({ files: [{ id: `upload-${state.imageUploads + state.audioUploads}`, url: `https://r2.syntx.ai/uploaded/${file.name}`,
        filename: file.name, mime_type: file.type, content_type: file.type, media_type: image ? "image" : "audio",
        type: image ? "image" : "audio", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      state.chatCreates += 1; return json({ uuid: `wan-1665-chat-${state.chatCreates}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      assert.equal(url.searchParams.get("ai_name"), "wan_video");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      const chat = body.chat_id;
      state.modelsByChat.set(chat, String(body.settings.model_type)); state.promptsByChat.set(chat, body.prompt);
      assert.equal(Object.hasOwn(body.settings, "duration"), false);
      const files = body.settings.file_urls as readonly { type: string; url: string }[];
      assert.equal(files[0]?.type, "image"); assert.ok(files[0]?.url.startsWith("https://r2.syntx.ai/uploaded/"));
      assert.ok(files.length === 1 || (files.length === 2 && files[1]?.type === "audio"));
      state.videoBodies.push(body as unknown as Record<string, unknown>); state.generationPosts += 1;
      const ack = `wan-1665-ack-${state.generationPosts}`; state.acksByChat.set(chat, ack);
      if (state.loseNextStartAck) { state.loseNextStartAck = false; throw new Error("synthetic lost START acknowledgement"); }
      return json({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      const chat = decodeURIComponent(history[1]!); state.historyGets += 1;
      state.historyGetsByChat.set(chat, (state.historyGetsByChat.get(chat) ?? 0) + 1);
      const ack = state.acksByChat.get(chat) ?? `wan-1665-ack-${chat.split("-").at(-1)}`;
      const model = state.modelsByChat.get(chat)!, prompt = state.promptsByChat.get(chat)!;
      const owner = { id: ack, chat_id: 421, author_id: 27,
        message_object: [{ id: `text-${chat}`, message_id: ack, object_type: "text", model_type: model, object_text: prompt }] };
      const botId = `wan-1665-bot-${chat}`;
      const bot = { id: botId, chat_id: 421, author_id: -1,
        message_object: [{ id: `video-${chat}`, message_id: botId, object_type: "video", model_type: model, completed: true }] };
      return json(page([owner, bot]));
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      const chat = decodeURIComponent(result[1]!); const message = decodeURIComponent(result[2]!);
      state.resultGets += 1;
      const calls = (state.resultGetsByChat.get(chat) ?? 0) + 1; state.resultGetsByChat.set(chat, calls);
      const pending = state.pendingFirstResult && calls === 1;
      return json({ id: message, chat_id: 421, author_id: -1, message_object: [{ id: `video-${chat}`,
        message_id: message, object_type: "video", model_type: state.modelsByChat.get(chat), completed: !pending,
        object_url: pending ? null : `https://r2.syntx.ai/generated/${chat}.mp4` }] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  };
}

function structured<T extends Record<string, unknown>>(result: unknown): T {
  assert.ok(result && typeof result === "object", "stock SDK should return a call result");
  const value = Reflect.get(result, "structuredContent");
  assert.ok(value && typeof value === "object", "stock SDK should return structuredContent");
  return value as T;
}

async function makeAudioFixtures(directory: string): Promise<{ mp3: Buffer; wav: Buffer }> {
  assert.ok(MEDIA_PAIRS, "positive audio proof requires a real local ffmpeg/ffprobe pair");
  const mp3Path = join(directory, "synthetic-tone.mp3"), wavPath = join(directory, "synthetic-tone.wav");
  await exec(MEDIA_PAIRS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
    "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", mp3Path]);
  await exec(MEDIA_PAIRS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=3.4",
    "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le", wavPath]);
  await exec(MEDIA_PAIRS.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mp3Path]);
  await exec(MEDIA_PAIRS.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", wavPath]);
  return { mp3: await readFile(mp3Path), wav: await readFile(wavPath) };
}

test("stock MCP SDK drives the real WAN26 runtime for both model IDs, measured audio, unknown-ACK recovery and revoke", async () => {
  assert.ok(MEDIA_PAIRS, "ffmpeg/ffprobe are required for the positive MP3/WAV runtime proof");
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-runtime-1665-"));
  const state = createState();
  let fixtures: { mp3: Buffer; wav: Buffer } | undefined;
  let runtime: ReturnType<typeof createObservedOwnerRuntime> | undefined;
  let server: ReturnType<typeof createMcpServer> | undefined;
  const originalGlobalFetch = globalThis.fetch;
  let globalFetchCalls = 0, injectedFetchCalls = 0;
  const performanceObject = globalThis.performance;
  const originalPerformanceDescriptor = Object.getOwnPropertyDescriptor(performanceObject, "now");
  const performanceNow = performanceObject.now.bind(performanceObject);
  let monotonicOffset = 0;
  Object.defineProperty(performanceObject, "now", { configurable: true, value: () => performanceNow() + monotonicOffset });
  globalThis.fetch = async () => { globalFetchCalls += 1; throw new Error("unexpected global fetch in WAN26 runtime test"); };
  const syntheticFetch = createSyntheticFetch(state);
  const fetchImpl: typeof fetch = async (input, init) => { injectedFetchCalls += 1; return syntheticFetch(input, init); };
  const client = new Client({ name: "wan26-stock-sdk-positive-1665", version: "1" });
  const imageBytes = png384();
  try {
    fixtures = await makeAudioFixtures(directory);
    const baselineRuntime = createObservedOwnerRuntime({ fetchImpl, catalogDirectory: CATALOG_DIRECTORY, now: () => state.wallNow });
    const baselineServer = createMcpServer(baselineRuntime.application, baselineRuntime.serverOptions);
    const baselineClient = new Client({ name: "wan26-stock-sdk-baseline-1665", version: "1" });
    const [baselineClientTransport, baselineServerTransport] = InMemoryTransport.createLinkedPair();
    let baselineNames: string[] = [];
    try {
      await baselineServer.connect(baselineServerTransport); await baselineClient.connect(baselineClientTransport);
      baselineNames = (await baselineClient.listTools()).tools.map(({ name }) => name);
    } finally {
      await baselineClient.close().catch(() => undefined); await baselineServer.close().catch(() => undefined);
      baselineRuntime.authStore.close?.();
    }
    assert.equal(baselineNames.some((name) => (TOOL_NAMES as readonly string[]).includes(name)), false);
    const activeRuntime = createObservedOwnerRuntime({ ownerWan26I2vEnabled: true, ownerWan26I2vFfprobePath: MEDIA_PAIRS.ffprobe,
      fetchImpl, catalogDirectory: CATALOG_DIRECTORY, now: () => state.wallNow, requestTimeoutMs: 10_000 });
    runtime = activeRuntime;
    const activeServer = createMcpServer(activeRuntime.application, activeRuntime.serverOptions);
    server = activeServer;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
    await activeServer.connect(serverTransport); await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (TOOL_NAMES as readonly string[]).includes(name)), TOOL_NAMES);
    assert.ok(baselineNames.every((name) => names.includes(name)), "WAN26 registration preserves the full default tool surface");
    for (const tool of listed.tools.filter(({ name }) => (TOOL_NAMES as readonly string[]).includes(name))) {
      assert.equal(tool.inputSchema.type, "object"); assert.equal(tool.outputSchema?.type, "object");
      assert.equal("oneOf" in tool.inputSchema, false); assert.equal("anyOf" in tool.inputSchema, false);
      assert.equal("oneOf" in (tool.outputSchema ?? {}), false); assert.equal("anyOf" in (tool.outputSchema ?? {}), false);
    }
    const generateTool = listed.tools.find(({ name }) => name === TOOL_NAMES[3]); assert.ok(generateTool?.outputSchema);
    const generateSchema = generateTool.inputSchema as { properties?: Record<string, { enum?: unknown[] }>;
      additionalProperties?: boolean };
    assert.deepEqual(generateSchema.properties?.model_id?.enum, ["wan_26_i2v", "wan_26_i2v_flash"]);
    assert.equal(generateSchema.additionalProperties, false);
    const previousNames = names.filter((name) => !(TOOL_NAMES as readonly string[]).includes(name));
    assert.ok(previousNames.includes("syntx_begin_login") && previousNames.includes("syntx_check_login") && previousNames.includes("syntx_unlink"));

    const begin = structured<{ attempt_id: string; status: string }>(await call("syntx_begin_login", {}));
    assert.equal(begin.status, "HANDOFF_ISSUED");
    const attemptId = begin.attempt_id;
    const checked = structured<{ attempt_id: string; status: string; linked: boolean }>(await call("syntx_check_login", { attempt_id: attemptId }));
    assert.equal(checked.attempt_id, attemptId); assert.equal(checked.status, "LINKED"); assert.equal(checked.linked, true);

    const parameterTool = await call(TOOL_NAMES[0], {});
    const parameters = structured<{ status: string; public_catalog_version: string; public_catalog_fetched_at: string;
      public_models_sha256: string; files_mention: boolean; provider_acceptance: string; dispatch_allowed: boolean }>(parameterTool);
    assert.equal(parameters.status, "ready");
    assert.equal(parameters.public_catalog_version, "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
    assert.equal(parameters.public_catalog_fetched_at, "2026-10-15T07:17:24.901Z");
    assert.equal(parameters.public_models_sha256, "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a");
    assert.equal(parameters.files_mention, false); assert.equal(parameters.provider_acceptance, "UNPROVEN");
    assert.equal(parameters.dispatch_allowed, false);

    const uploadImage = async (model_id: "wan_26_i2v" | "wan_26_i2v_flash", name: string) => {
      const result = await call(TOOL_NAMES[1], { link_attempt_id: attemptId, model_id, filename: name,
        mime_type: "image/png", content_base64: imageBytes.toString("base64") });
      const value = structured<{ status: string; image_handle: string; width: number; height: number }>(result);
      assert.equal(value.status, "uploaded"); assert.equal(value.width, 384); assert.equal(value.height, 384);
      assert.equal("url" in value, false);
      return value.image_handle;
    };
    const uploadAudio = async (bytes: Buffer, mime_type: "audio/mp3" | "audio/wav", name: string) => {
      const result = await call(TOOL_NAMES[2], { link_attempt_id: attemptId, model_id: mime_type === "audio/mp3" ? "wan_26_i2v" : "wan_26_i2v_flash",
        filename: name, mime_type, content_base64: bytes.toString("base64") });
      const value = structured<{ status: string; audio_handle: string; duration_seconds: number; mime_type: string }>(result);
      assert.equal(value.status, "uploaded"); assert.ok(value.duration_seconds >= 3 && value.duration_seconds <= 30);
      assert.ok(Math.abs(value.duration_seconds - 3.4) < 0.2, "duration must come from probing the generated audio bytes");
      assert.equal(value.mime_type, mime_type === "audio/mp3" ? "audio/mpeg" : "audio/wav"); assert.equal("url" in value, false);
      return value.audio_handle;
    };
    const generate = async (model_id: "wan_26_i2v" | "wan_26_i2v_flash", image_handle: string,
      audio_handle: string | null, prompt: string) => call(TOOL_NAMES[3], { link_attempt_id: attemptId, model_id, image_handle,
      audio_handle, prompt, resolution: "720P", aspect_ratio: "16:9", video_duration: 6, prompt_extend: true, seed: null,
      native_audio: model_id === "wan_26_i2v_flash" });

    const regularImage = await uploadImage("wan_26_i2v", "regular-image-only.png");
    const regularOnly = await generate("wan_26_i2v", regularImage, null, "wan 1665 regular image only");
    const regularOnlyData = structured<{ status: string; model_id: string; recovery_id: string; observed_artifact_count: number;
      status_semantics: string; provider_terminal_status: string; backend_acceptance: string; cost_cap_enforced: boolean;
      artifacts: readonly { object_url: string; model_id: string }[] }>(regularOnly);
    assert.equal(regularOnly.isError, undefined); assert.equal(regularOnlyData.status, "completed");
    assert.equal(regularOnlyData.model_id, "wan_26_i2v"); assert.equal(regularOnlyData.observed_artifact_count, 1);
    assert.equal(regularOnlyData.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(regularOnlyData.provider_terminal_status, "UNPROVEN"); assert.equal(regularOnlyData.backend_acceptance, "UNPROVEN");
    assert.equal(regularOnlyData.cost_cap_enforced, false); assert.equal(regularOnlyData.artifacts[0]?.model_id, "wan_26_i2v");

    const flashImage = await uploadImage("wan_26_i2v_flash", "flash-image-only.png");
    const flashOnly = await generate("wan_26_i2v_flash", flashImage, null, "wan 1665 flash image only");
    const flashOnlyData = structured<{ status: string; recovery_id: string; artifacts: readonly { model_id: string }[] }>(flashOnly);
    assert.equal(flashOnly.isError, undefined); assert.equal(flashOnlyData.status, "completed");
    assert.equal(flashOnlyData.artifacts[0]?.model_id, "wan_26_i2v_flash");

    const regularAudioImage = await uploadImage("wan_26_i2v", "regular-mp3-image.png");
    const mp3Handle = await uploadAudio(fixtures.mp3, "audio/mp3", "synthetic-tone.mp3");
    const regularMp3 = await generate("wan_26_i2v", regularAudioImage, mp3Handle, "wan 1665 regular image and measured mp3");
    assert.equal(structured<{ status: string }>(regularMp3).status, "completed");

    const flashAudioImage = await uploadImage("wan_26_i2v_flash", "flash-wav-image.png");
    const wavHandle = await uploadAudio(fixtures.wav, "audio/wav", "synthetic-tone.wav");
    state.loseNextStartAck = true;
    const unknown = await generate("wan_26_i2v_flash", flashAudioImage, wavHandle, "wan 1665 flash image and measured wav lost ack");
    assert.equal(unknown.isError, true);
    const unknownData = structured<{ status: string; error_code: string; recovery_id: string }>(unknown);
    assert.equal(unknownData.status, "unavailable"); assert.equal(unknownData.error_code, "OUTCOME_UNKNOWN");
    assert.match(unknownData.recovery_id, /^wan26_generation_recovery_[0-9a-f-]{36}$/u);

    assert.equal(state.generationPosts, 4); assert.equal(state.chatCreates, 4);
    assert.equal(state.balanceReads, 8); assert.equal(state.subscriptionReads, 8); assert.equal(state.quoteCalls.length, 8);
    for (const quote of state.quoteCalls) {
      const keys = Object.keys(quote).filter((key) => key !== "ai_name" && key !== "model_type").sort();
      assert.deepEqual(keys, quote.model_type === "wan_26_i2v"
        ? ["resolution", "video_duration"]
        : ["native_audio", "resolution", "video_duration"]);
      assert.equal(quote.resolution, "720P"); assert.equal(quote.video_duration, "6");
      if (quote.model_type === "wan_26_i2v_flash") assert.equal(quote.native_audio, "true");
    }
    for (const [index, body] of state.videoBodies.entries()) {
      const settings = body.settings as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
      assert.deepEqual(Object.keys(settings).sort(), ["aspect_ratio", "audio_setting", "file_urls", "model_type", "native_audio",
        "prompt_extend", "resolution", "seed", "shot_type", "video_duration"]);
      assert.equal(body.prompt, ["wan 1665 regular image only", "wan 1665 flash image only",
        "wan 1665 regular image and measured mp3", "wan 1665 flash image and measured wav lost ack"][index]);
      assert.equal(settings.model_type, index === 0 || index === 2 ? "wan_26_i2v" : "wan_26_i2v_flash");
      assert.equal(settings.resolution, "720P"); assert.equal(settings.video_duration, 6);
      assert.equal(settings.prompt_extend, true); assert.equal(settings.seed, null); assert.equal(settings.shot_type, "single");
      assert.equal(settings.audio_setting, "auto"); assert.equal(Object.hasOwn(settings, "duration"), false);
      assert.equal(settings.native_audio, index === 1 || index === 3);
      const files = settings.file_urls as readonly { type: string; url: string }[];
      assert.deepEqual(files.map(({ type }) => type), index < 2 ? ["image"] : ["image", "audio"]);
      assert.ok(files.every(({ url }) => url.startsWith("https://r2.syntx.ai/uploaded/")));
    }

    // Advance the real preparer/reference monotonic clock past their 15-minute TTL.
    // A fresh generate call traverses the real prepare() path and prunes its expired candidate.
    monotonicOffset += 16 * 60_000; state.wallNow += 16 * 60_000;
    const expiredReuse = await generate("wan_26_i2v_flash", flashAudioImage, wavHandle, "new intent after candidate prune");
    assert.equal(expiredReuse.isError, true);
    assert.equal(state.chatCreates, 4); assert.equal(state.generationPosts, 4);
    state.subscriptionActive = false;
    const freshImage = await uploadImage("wan_26_i2v", "expired-account-image.png");
    const accountExpired = await generate("wan_26_i2v", freshImage, null, "inactive account must stop before native create");
    assert.equal(accountExpired.isError, true);
    const expiredData = structured<{ status: string; error_code: string }>(accountExpired);
    assert.equal(expiredData.status, "unavailable"); assert.equal(expiredData.error_code, "PREFLIGHT_FAILED");
    assert.equal(state.chatCreates, 4); assert.equal(state.generationPosts, 4);

    const historyAtUnknown = state.historyGets, resultAtUnknown = state.resultGets;
    const reconcile = await call(TOOL_NAMES[4], { link_attempt_id: attemptId, recovery_id: unknownData.recovery_id });
    assert.equal(reconcile.isError, undefined);
    const recovered = structured<{ status: string; recovery_id: string; model_id: string; observed_artifact_count: number;
      provider_terminal_status: string; backend_acceptance: string; artifacts: readonly { object_url: string }[] }>(reconcile);
    assert.equal(recovered.status, "completed"); assert.equal(recovered.recovery_id, unknownData.recovery_id);
    assert.equal(recovered.model_id, "wan_26_i2v_flash"); assert.equal(recovered.observed_artifact_count, 1);
    assert.equal(recovered.provider_terminal_status, "UNPROVEN"); assert.equal(recovered.backend_acceptance, "UNPROVEN");
    assert.ok(recovered.artifacts[0]?.object_url.startsWith("https://r2.syntx.ai/generated/"));
    assert.equal(state.generationPosts, 4); assert.equal(state.chatCreates, 4);
    assert.equal(state.historyGets, historyAtUnknown + 1); assert.equal(state.resultGets, resultAtUnknown + 1);

    const getCallsAfterRecovery = state.historyGets + state.resultGets;
    const resultPage = await call(TOOL_NAMES[6], { link_attempt_id: attemptId, recovery_id: unknownData.recovery_id, offset: 0 });
    const pageData = structured<{ status: string; observed_artifact_count: number; artifacts: readonly { model_id: string }[] }>(resultPage);
    assert.equal(pageData.status, "completed"); assert.equal(pageData.observed_artifact_count, 1);
    assert.equal(pageData.artifacts[0]?.model_id, "wan_26_i2v_flash");
    const recoveries = await call(TOOL_NAMES[5], { link_attempt_id: attemptId, limit: 10 });
    assert.equal(structured<{ status: string }>(recoveries).status, "listed");
    assert.equal(state.historyGets + state.resultGets, getCallsAfterRecovery, "cached page/list must not call upstream GET");

    const unlinked = await call("syntx_unlink", { attempt_id: attemptId });
    assert.equal(structured<{ status: string }>(unlinked).status, "REVOKED");
    const revokedPage = await call(TOOL_NAMES[6], { link_attempt_id: attemptId, recovery_id: unknownData.recovery_id, offset: 0 });
    assert.equal(revokedPage.isError, true); assert.equal(state.generationPosts, 4);
    assert.equal(globalFetchCalls, 0); assert.ok(injectedFetchCalls > 0);
  } finally {
    await client.close().catch(() => undefined); await server?.close().catch(() => undefined);
    await runtime?.ownerWan26I2vLifecycle?.close().catch(() => undefined); runtime?.authStore.close?.();
    globalThis.fetch = originalGlobalFetch; imageBytes.fill(0); fixtures?.mp3.fill(0); fixtures?.wav.fill(0);
    if (originalPerformanceDescriptor) Object.defineProperty(performanceObject, "now", originalPerformanceDescriptor);
    else Reflect.deleteProperty(performanceObject, "now");
    await rm(directory, { recursive: true, force: true });
  }
});
