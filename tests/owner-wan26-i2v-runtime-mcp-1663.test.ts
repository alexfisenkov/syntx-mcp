import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { promisify } from "node:util";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import type { ProviderCredential } from "../src/auth/types.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import * as ownerStdio from "../src/transports/stdio-owner.js";

const WAN26_TOOL_NAMES = [
  "syntx_owner_get_wan26_i2v_parameters",
  "syntx_owner_upload_wan26_i2v_image",
  "syntx_owner_upload_wan26_i2v_audio",
  "syntx_owner_generate_wan26_i2v_video",
  "syntx_owner_reconcile_wan26_i2v_video",
  "syntx_owner_list_wan26_i2v_recoveries",
  "syntx_owner_get_wan26_i2v_result_page"
] as const;
const FFPROBE = "/opt/homebrew/bin/ffprobe";
const FFMPEG_PROBE_PAIRS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
];
const MEDIA = FFMPEG_PROBE_PAIRS.find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const exec = promisify(execFile);

async function toolList(runtime: ReturnType<typeof createObservedOwnerRuntime>) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan26-runtime-mcp-1663", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try { return { client, server, tools: (await client.listTools()).tools }; }
  catch (error) { await client.close(); await server.close(); throw error; }
}

async function closeRuntime(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<void> {
  await runtime.ownerWan26I2vLifecycle?.close();
  runtime.authStore.close?.();
}

function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29);
  return bytes;
}

async function seedLinkedAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string): Promise<void> {
  const store = runtime.authStore as InMemoryAuthLinkStore;
  const binding = runtime.authBinding;
  await store.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await store.beginHandoff(binding, attemptId);
  await store.attachChallenge(binding, attemptId, `wan26-native-${attemptId}`);
  await store.beginPoll(binding, attemptId);
  const credential: ProviderCredential = { scheme: "Bearer", value: "synthetic-runtime-owner-token" };
  await store.markLinked(binding, attemptId, credential);
}

function createRuntimeFetch() {
  const state = { imageUploads: 0, audioUploads: 0, chatCreates: 0, generationPosts: 0,
    videoBodies: [] as Record<string, unknown>[], prompts: new Map<string, string>(), models: new Map<string, string>() };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl), method = init.method ?? (input instanceof Request ? input.method : "GET");
    const json = (value: unknown) => Response.json(value);
    if (url.pathname === "/api/v1/user/balance") return json({ balance: "920.5" });
    if (url.pathname === "/api/v1/user/subscription") return json({ active: true, type: "PRO", end_date: new Date(Date.now() + 3_600_000).toISOString() });
    if (url.pathname === "/api/v2/get_model_info") return json({ access: true, cost: 7.5, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData, file = form.get("files");
      assert.ok(file instanceof File); assert.equal(form.get("destination"), "uploaded");
      if (file.type.startsWith("image/")) state.imageUploads += 1; else state.audioUploads += 1;
      const id = `native-upload-${state.imageUploads + state.audioUploads}`;
      return json({ files: [{ id, url: `https://r2.syntx.ai/uploaded/${file.name}`, filename: file.name,
        mime_type: file.type, content_type: file.type, media_type: file.type.startsWith("image/") ? "image" : "audio",
        type: file.type.startsWith("image/") ? "image" : "audio", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      state.chatCreates += 1; return json({ uuid: `runtime-wan-chat-${state.chatCreates}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      assert.equal(url.searchParams.get("ai_name"), "wan_video");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      const chatId = body.chat_id;
      state.models.set(chatId, String(body.settings.model_type)); state.prompts.set(chatId, body.prompt);
      assert.equal(Object.hasOwn(body.settings, "duration"), false);
      const files = body.settings.file_urls as readonly { type: string; url: string }[];
      assert.equal(files[0]?.type, "image"); assert.equal(files.length === 2 ? files[1]?.type : undefined, files.length === 2 ? "audio" : undefined);
      state.videoBodies.push(body as unknown as Record<string, unknown>); state.generationPosts += 1;
      return json({ id: `runtime-wan-ack-${state.generationPosts}` });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history) {
      const chatId = decodeURIComponent(history[1]!), ack = `runtime-wan-ack-${chatId.split("-").at(-1)}`;
      const modelId = state.models.get(chatId)!, prompt = state.prompts.get(chatId)!;
      const owner = { id: ack, chat_id: 421, author_id: 27, message_object: [{ id: `text-${chatId}`, message_id: ack,
        object_type: "text", model_type: modelId, object_text: prompt }] };
      const botId = `runtime-wan-bot-${chatId}`;
      const bot = { id: botId, chat_id: 421, author_id: -1, message_object: [{ id: `video-${chatId}`, message_id: botId,
        object_type: "video", model_type: modelId, completed: true }] };
      return json({ messages: [owner, bot], pagination: { page: 1, page_size: 10, total_count: 2,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result) {
      const chatId = decodeURIComponent(result[1]!), messageId = decodeURIComponent(result[2]!);
      return json({ id: messageId, chat_id: 421, author_id: -1, message_object: [{ id: `video-${chatId}`,
        message_id: messageId, object_type: "video", model_type: state.models.get(chatId), completed: true,
        object_url: `https://r2.syntx.ai/generated/${chatId}.mp4` }] });
    }
    throw new Error(`unexpected mock route ${method} ${url.pathname}`);
  };
  return { fetchImpl, state };
}

test("WAN26 runtime is absent by default, rejects bad operator paths before transport, and opts into exactly seven flat tools", async () => {
  let injectedFetchCalls = 0, globalFetchCalls = 0;
  const priorGlobalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { globalFetchCalls += 1; throw new Error("Unexpected global fetch"); }) as typeof fetch;
  const fetchImpl: typeof fetch = async () => { injectedFetchCalls += 1; throw new Error("Unexpected injected fetch"); };
  const stdioApi = ownerStdio as unknown as Record<string, unknown>;
  try {
    assert.equal(typeof stdioApi.readOwnerWan26I2vFlag, "function");
    assert.equal(typeof stdioApi.readOwnerWan26I2vOperatorConfiguration, "function");
    const readFlag = stdioApi.readOwnerWan26I2vFlag as (value: string | undefined) => boolean;
    const readOperatorConfiguration = stdioApi.readOwnerWan26I2vOperatorConfiguration as
      (enabled: boolean, value: string | undefined) => Readonly<{ ffprobePath: string }> | undefined;
    for (const value of [undefined, "", "0"]) assert.equal(readFlag(value), false);
    assert.equal(readFlag("1"), true);
    for (const value of ["true", "false", "01", " 1", "1 ", "2"]) assert.throws(() => readFlag(value));
    assert.equal(readOperatorConfiguration(false, undefined), undefined);
    assert.deepEqual(readOperatorConfiguration(true, FFPROBE), { ffprobePath: FFPROBE });
    for (const value of [undefined, "", "ffprobe", "relative/ffprobe", "/tmp/ffprobe\0x"]) {
      assert.throws(() => readOperatorConfiguration(true, value));
    }

    const defaults = createObservedOwnerRuntime({ fetchImpl, catalogDirectory: CATALOG_DIRECTORY });
    assert.equal((defaults.serverOptions as unknown as Record<string, unknown>).ownerWan26I2v, undefined);
    const defaultList = await toolList(defaults);
    const defaultNames = defaultList.tools.map(({ name }) => name);
    assert.equal(defaultNames.some((name) => (WAN26_TOOL_NAMES as readonly string[]).includes(name)), false);
    await defaultList.client.close(); await defaultList.server.close();
    await closeRuntime(defaults);

    assert.throws(() => createObservedOwnerRuntime({ ownerWan26I2vEnabled: true, ownerWan26I2vFfprobePath: "relative/ffprobe",
      fetchImpl, catalogDirectory: CATALOG_DIRECTORY }),
      /OWNER_WAN26_I2V_OPERATOR_CONFIGURATION_REQUIRED/u);
    assert.equal(injectedFetchCalls, 0); assert.equal(globalFetchCalls, 0);

    const enabled = createObservedOwnerRuntime({ ownerWan26I2vEnabled: true, ownerWan26I2vFfprobePath: FFPROBE,
      fetchImpl, catalogDirectory: CATALOG_DIRECTORY });
    try {
      const owner = enabled as unknown as { ownerWan26I2vLifecycle?: { close(): Promise<void> } };
      assert.ok(owner.ownerWan26I2vLifecycle);
      const list = await toolList(enabled);
      const names = list.tools.map(({ name }) => name);
      assert.deepEqual(names.filter((name) => (WAN26_TOOL_NAMES as readonly string[]).includes(name)).sort(), [...WAN26_TOOL_NAMES].sort());
      assert.deepEqual(names.filter((name) => !(WAN26_TOOL_NAMES as readonly string[]).includes(name)).sort(), defaultNames.sort());
      for (const tool of list.tools.filter(({ name }) => (WAN26_TOOL_NAMES as readonly string[]).includes(name))) {
        assert.equal(tool.inputSchema.type, "object");
        assert.equal("oneOf" in tool.inputSchema, false); assert.equal("anyOf" in tool.inputSchema, false);
        assert.ok(tool.outputSchema); assert.equal(tool.outputSchema.type, "object");
        assert.equal("oneOf" in tool.outputSchema, false); assert.equal("anyOf" in tool.outputSchema, false);
      }
      const generate = list.tools.find(({ name }) => name === WAN26_TOOL_NAMES[3])!;
      const inputSchema = generate.inputSchema as { properties?: Record<string, { enum?: unknown[]; type?: unknown }>;
        required?: string[]; additionalProperties?: boolean };
      assert.deepEqual(inputSchema.properties?.model_id?.enum, ["wan_26_i2v", "wan_26_i2v_flash"]);
      assert.ok(inputSchema.properties?.audio_handle);
      assert.equal(inputSchema.required?.includes("audio_handle"), true);
      assert.equal(inputSchema.additionalProperties, false);
      assert.equal(injectedFetchCalls, 0); assert.equal(globalFetchCalls, 0);
      const invalidPng = png384();
      const unavailable = await list.client.callTool({ name: WAN26_TOOL_NAMES[1], arguments: {
        link_attempt_id: "link_wan26_runtime_mcp_1663_0123456789", model_id: "wan_26_i2v", filename: "x.png",
        mime_type: "image/png", content_base64: invalidPng.toString("base64")
      } });
      invalidPng.fill(0);
      assert.equal(unavailable.isError, true);
      const firstContent: unknown = Array.isArray(unavailable.content) ? unavailable.content[0] : undefined;
      if (!firstContent || typeof firstContent !== "object" || !("type" in firstContent) || !("text" in firstContent) ||
          firstContent.type !== "text" || typeof firstContent.text !== "string") {
        throw new Error("WAN26 unavailable tool result did not contain its typed text payload.");
      }
      const unavailableData: unknown = unavailable.structuredContent ?? JSON.parse(firstContent.text);
      assert.equal((unavailableData as { status?: string; error_code?: string }).status, "unavailable");
      assert.equal((unavailableData as { error_code?: string }).error_code, "PRINCIPAL_NOT_LINKED");
      await list.client.close(); await list.server.close();
    } finally { await closeRuntime(enabled); }
  } finally { globalThis.fetch = priorGlobalFetch; }
});

test("WAN26 MCP output accepts both generation diagnostic counters through the service's 10,000-call bound", async () => {
  const runtime = createObservedOwnerRuntime({ ownerWan26I2vEnabled: true, ownerWan26I2vFfprobePath: FFPROBE,
    catalogDirectory: CATALOG_DIRECTORY });
  const list = await toolList(runtime);
  try {
    const generate = list.tools.find(({ name }) => name === WAN26_TOOL_NAMES[3]);
    assert.ok(generate?.outputSchema);
    type JsonSchema = { type?: string; maximum?: number; anyOf?: JsonSchema[]; properties?: Record<string, JsonSchema> };
    const output = generate.outputSchema as JsonSchema;
    const diagnostic = output.properties?.diagnostic;
    const diagnosticObject = diagnostic?.anyOf?.find((branch) => branch.type === "object") ?? diagnostic;
    assert.equal(diagnosticObject?.properties?.history_get_calls?.maximum, 10_000);
    assert.equal(diagnosticObject?.properties?.result_get_calls?.maximum, 10_000);
    const audio = list.tools.find(({ name }) => name === WAN26_TOOL_NAMES[2]);
    assert.ok(audio?.description?.includes("MP3 or PCM-WAV"));
  } finally {
    await list.client.close(); await list.server.close(); await closeRuntime(runtime);
  }
});

test("real WAN26 runtime and SDK tools upload both models, probe actual audio, and perform local-observation generation", async (t) => {
  if (!MEDIA) { t.skip("supported local ffmpeg/ffprobe pair is unavailable"); return; }
  try { await exec(MEDIA.ffmpeg, ["-version"]); await exec(MEDIA.ffprobe, ["-version"]); }
  catch { t.skip("supported local ffmpeg/ffprobe pair is unavailable"); return; }

  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-runtime-1663-"));
  const audioPath = join(directory, "tone.mp3");
  const audioBytes = await (async () => {
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", audioPath]);
    return readFile(audioPath);
  })();
  const attemptId = "link_wan26_runtime_mcp_1663_0123456789";
  let injectedFetchCalls = 0, globalFetchCalls = 0;
  const priorGlobalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { globalFetchCalls += 1; throw new Error("Unexpected global fetch"); }) as typeof fetch;
  const mock = createRuntimeFetch();
  const fetchImpl: typeof fetch = async (input, init) => { injectedFetchCalls += 1; return mock.fetchImpl(input, init); };
  const runtime = createObservedOwnerRuntime({ ownerWan26I2vEnabled: true, ownerWan26I2vFfprobePath: MEDIA.ffprobe,
    fetchImpl, catalogDirectory: CATALOG_DIRECTORY });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan26-runtime-mcp-positive-1663", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const png = png384();
  try {
    await seedLinkedAttempt(runtime, attemptId);
    await server.connect(serverTransport); await client.connect(clientTransport);
    const parameters = await call(WAN26_TOOL_NAMES[0], {});
    const source = parameters.structuredContent as { status?: string; public_catalog_version?: string; files_mention?: boolean;
      public_catalog_fetched_at?: string; public_models_sha256?: string };
    assert.equal(source.status, "ready");
    assert.equal(source.public_catalog_version, "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
    assert.equal(source.public_catalog_fetched_at, "2026-10-15T07:17:24.901Z");
    assert.equal(source.public_models_sha256, "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a");
    assert.equal(source.files_mention, false);

    const imageRegular = await call(WAN26_TOOL_NAMES[1], { link_attempt_id: attemptId, model_id: "wan_26_i2v",
      filename: "regular-frame.png", mime_type: "image/png", content_base64: png.toString("base64") });
    const regularHandle = (imageRegular.structuredContent as { image_handle?: string }).image_handle;
    assert.equal((imageRegular.structuredContent as { status?: string }).status, "uploaded");
    assert.equal(typeof regularHandle, "string"); assert.equal("url" in (imageRegular.structuredContent as object), false);
    const imageFlash = await call(WAN26_TOOL_NAMES[1], { link_attempt_id: attemptId, model_id: "wan_26_i2v_flash",
      filename: "flash-frame.png", mime_type: "image/png", content_base64: png.toString("base64") });
    const flashHandle = (imageFlash.structuredContent as { image_handle?: string }).image_handle;
    assert.equal((imageFlash.structuredContent as { status?: string }).status, "uploaded");

    const audio = await call(WAN26_TOOL_NAMES[2], { link_attempt_id: attemptId, model_id: "wan_26_i2v_flash",
      filename: "tone.mp3", mime_type: "audio/mp3", content_base64: audioBytes.toString("base64") });
    const audioHandle = (audio.structuredContent as { audio_handle?: string }).audio_handle;
    assert.equal((audio.structuredContent as { status?: string }).status, "uploaded");
    assert.equal(typeof audioHandle, "string"); assert.equal("url" in (audio.structuredContent as object), false);

    const regular = await call(WAN26_TOOL_NAMES[3], { link_attempt_id: attemptId, model_id: "wan_26_i2v",
      image_handle: regularHandle!, audio_handle: null, prompt: "runtime image-only test", resolution: "720P",
      aspect_ratio: "16:9", video_duration: 6, prompt_extend: true, seed: null, native_audio: false });
    const regularResult = regular.structuredContent as { status?: string; model_id?: string; status_semantics?: string;
      provider_terminal_status?: string; artifacts?: readonly { object_url: string }[]; recovery_id?: string };
    assert.equal(regularResult.status, "completed"); assert.equal(regularResult.model_id, "wan_26_i2v");
    assert.equal(regularResult.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(regularResult.provider_terminal_status, "UNPROVEN");
    assert.equal(regularResult.artifacts?.[0]?.object_url.startsWith("https://r2.syntx.ai/generated/"), true);

    const flash = await call(WAN26_TOOL_NAMES[3], { link_attempt_id: attemptId, model_id: "wan_26_i2v_flash",
      image_handle: flashHandle!, audio_handle: audioHandle!, prompt: "runtime image and audio test", resolution: "1080P",
      aspect_ratio: "9:16", video_duration: 8, prompt_extend: false, seed: 42, native_audio: true });
    const flashResult = flash.structuredContent as { status?: string; model_id?: string; recovery_id?: string;
      artifacts?: readonly { object_url: string }[] };
    assert.equal(flashResult.status, "completed"); assert.equal(flashResult.model_id, "wan_26_i2v_flash");
    assert.equal(typeof flashResult.recovery_id, "string"); assert.equal(flashResult.artifacts?.length, 1);
    assert.equal(mock.state.generationPosts, 2); assert.equal(mock.state.chatCreates, 2);
    const settings = mock.state.videoBodies.map((body) => (body.settings as Record<string, unknown>));
    assert.equal(settings.some((item) => Object.hasOwn(item, "duration")), false);
    assert.equal((settings[0]?.file_urls as unknown[]).length, 1);
    assert.equal((settings[1]?.file_urls as unknown[]).length, 2);

    const page = await call(WAN26_TOOL_NAMES[6], { link_attempt_id: attemptId, recovery_id: flashResult.recovery_id, offset: 0 });
    assert.equal((page.structuredContent as { status?: string }).status, "completed");
    const reconciled = await call(WAN26_TOOL_NAMES[4], { link_attempt_id: attemptId, recovery_id: flashResult.recovery_id });
    assert.equal((reconciled.structuredContent as { status?: string }).status, "completed");
    const recoveries = await call(WAN26_TOOL_NAMES[5], { link_attempt_id: attemptId, limit: 10 });
    assert.equal((recoveries.structuredContent as { status?: string }).status, "listed");
    assert.equal(injectedFetchCalls > 0, true); assert.equal(globalFetchCalls, 0);
  } finally {
    await client.close(); await server.close();
    await closeRuntime(runtime); png.fill(0); audioBytes.fill(0); globalThis.fetch = priorGlobalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
