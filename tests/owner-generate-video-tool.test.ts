import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { generateOneOwnerVideoForModel, type OwnerVideoChatClient } from "../src/application/owner-generate-video.js";
import { OwnerVideoRecoveryStore, reconcileOwnerVideoRecovery } from "../src/application/owner-video-recovery.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME } from "../src/mcp/owner-generate-video-tool.js";

const ATTEMPT = "link_owner_video_test_attempt01";
const instant = async (): Promise<void> => undefined;

function fakeClient(options: { final?: string; rejectDispatch?: boolean; modelType?: string; objectType?: string; mimeType?: string; onStart?: (request: Parameters<OwnerVideoChatClient["startVideo"]>[0]) => void }): OwnerVideoChatClient {
  let chatUuid = "video-chat-test";
  return {
    async createChat(scope) { assert.equal(scope, "video"); return { chat_uuid: chatUuid }; },
    async deleteChat(uuid) { assert.equal(uuid, chatUuid); return { chat_uuid: uuid, accepted: true }; },
    async startVideo(request) {
      options.onStart?.(request);
      if (options.rejectDispatch) throw new Error("network timeout after dispatch");
      return { chat_uuid: request.chat_id, message_id: "echo-video" };
    },
    async listInProgress() { return [{ message_id: "bot-video", message_object_id: "obj", object_type: "video", model_type: "seedance-2.0" }]; },
    async getMessage(uuid) {
      return {
        chat_uuid: uuid,
        message_id: "bot-video",
        object_type: options.objectType ?? "video",
        model_type: options.modelType ?? "seedance-2.0",
        artifacts: options.final ? [{ url: options.final, mime_type: options.mimeType ?? "video/mp4", duration_seconds: 5 }] : []
      };
    }
  };
}

test("owner video tool is absent unless separately wired", async () => {
  const server = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "video-absent", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try { assert.equal((await client.listTools()).tools.some((tool) => tool.name === SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME), false); }
  finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Seedance profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/seedance.mp4", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-result", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "seedance", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "seedance-2.0", resolution: "720p", mode: "mini", aspect_ratio: "16:9", video_duration: 5, generate_audio: true } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/seedance.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Seedance 1.5 Pro profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/seedance-15.mp4", modelType: "seedance-1.5-pro", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-seedance-15", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "seedance-1.5-pro", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "seedance", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "seedance-1.5-pro", resolution: "720p", aspect_ratio: "16:9", video_duration: 5, generate_audio: false } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/seedance-15.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Seedance Pro profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/seedance-pro.mp4", modelType: "seedance_pro", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-seedance-pro", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "seedance_pro", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "seedance", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "seedance_pro", resolution: "720p", mode: "mini", aspect_ratio: "16:9", video_duration: 5, generate_audio: true } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/seedance-pro.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Kling 3.0 turbo profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/kling.mp4", modelType: "kling_text2video", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-kling", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "kling_text2video", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "kling", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "kling_text2video", temperature: 0.5, aspect_ratio: "16:9", mode: "standart", version: "3.0-turbo", native_audio: false, video_duration: 5 } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/kling.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Luma Ray 3.14 profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/ray-3-14.mp4", modelType: "ray-3.14", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-luma", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "ray-3.14", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "luma", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "ray-3.14", video_duration: 5, quality: "720p", aspect_ratio: "16:9", gen_type: "text2video" } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/ray-3-14.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Sora 1 profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/sora-1.mp4", modelType: "sora_1", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-sora", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "sora_1", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "sora", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "sora_1", video_duration: 10, quality: 720, aspect_ratio: "16:9", gen_type: "text2video" } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/sora-1.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Wan 2.7 T2V profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/wan-27-t2v.mp4", modelType: "wan_27_t2v", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-wan-27", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "wan_27_t2v", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "wan_video", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "wan_27_t2v", file_urls: [], aspect_ratio: "1:1", resolution: "1080P", video_duration: 5, prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/wan-27-t2v.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Wan 2.6 T2V profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/wan-26-t2v.mp4", modelType: "wan_26_t2v", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-wan-26", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "wan_26_t2v", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "wan_video", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "wan_26_t2v", file_urls: [], aspect_ratio: "1:1", resolution: "720P", video_duration: 5, prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/wan-26-t2v.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Flux 3 T2V profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/flux3-t2v.mp4", modelType: "flux3_t2v", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-flux3", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "flux3_t2v", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "flux3_video", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "flux3_t2v", aspect_ratio: "auto", resolution: "hd", video_duration: 5, generate_audio: true } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/flux3-t2v.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Happy Horse T2V profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/happy-horse-t2v.mp4", modelType: "happy_horse_t2v", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-happy-horse", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "happy_horse_t2v", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "happy_horse", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "happy_horse_t2v", aspect_ratio: "16:9", resolution: "720P", video_duration: 5, native_audio: false, seed: null } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/happy-horse-t2v.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Runway text2video profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/runway-text2video.mp4", modelType: "text2video", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-runway-text2video", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "text2video", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "runway", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "text2video", video_duration: "5.0", seed: null, aspect_ratio: "1" } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/runway-text2video.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool routes exact Runway text2video-4.5 profile and returns redacted video", async () => {
  let request: Parameters<OwnerVideoChatClient["startVideo"]>[0] | undefined;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ final: "https://r2.syntx.ai/generated/runway-text2video-45.mp4", modelType: "text2video-4.5", onStart: (value) => { request = value; } }), wait: instant } });
  const client = new Client({ name: "video-runway-text2video-45", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "text2video-4.5", prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(request, { ai_name: "runway", chat_id: "video-chat-test", prompt: "A cinematic city at sunset", settings: { model_type: "text2video-4.5", video_duration: "5.0", seed: null, aspect_ratio: "169" } });
    assert.deepEqual((result.structuredContent as { videos: unknown[] }).videos, [{ url: "https://r2.syntx.ai/generated/runway-text2video-45.mp4", mime_type: "video/mp4", duration_seconds: 5 }]);
  } finally { await client.close(); await server.close(); }
});

test("owner video tool rejects other model before client resolution", async () => {
  let resolved = false;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => { resolved = true; return fakeClient({ final: "https://r2.syntx.ai/x.mp4" }); }, wait: instant } });
  const client = new Client({ name: "video-reject", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try { const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "veo3", prompt: "x", copies: 1 } }); assert.equal(result.isError, true); assert.equal(resolved, false); }
  finally { await client.close(); await server.close(); }
});

test("owner video checks a pre-aborted request before creating a chat", async () => {
  let createCalls = 0;
  const client: OwnerVideoChatClient = {
    ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
    async createChat() { createCalls += 1; return { chat_uuid: "must-not-be-created" }; }
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generateOneOwnerVideoForModel(client, "seedance-2.0", "x", controller.signal, instant));
  assert.equal(createCalls, 0);
});

test("owner video rechecks abort after createChat resolves and skips paid dispatch", async () => {
  const controller = new AbortController();
  let startCalls = 0;
  let deleteCalls = 0;
  const client: OwnerVideoChatClient = {
    ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
    async createChat() { controller.abort(); return { chat_uuid: "video-chat-aborted-during-create" }; },
    async startVideo() { startCalls += 1; return { chat_uuid: "video-chat-aborted-during-create", message_id: "echo" }; },
    async deleteChat(chat_uuid) { deleteCalls += 1; return { chat_uuid, accepted: true }; }
  };
  await assert.rejects(generateOneOwnerVideoForModel(client, "seedance-2.0", "x", controller.signal, instant));
  assert.equal(startCalls, 0);
  assert.equal(deleteCalls, 1);
});

test("owner video reserves recovery before dispatch and keeps a fixed unknown error if its callback throws", async () => {
  const calls: string[] = [];
  const client: OwnerVideoChatClient = {
    ...fakeClient({ rejectDispatch: true }),
    async startVideo() { calls.push("dispatch"); throw new Error("private upstream failure"); }
  };
  await assert.rejects(
    generateOneOwnerVideoForModel(
      client,
      "seedance-2.0",
      "x",
      undefined,
      instant,
      (chatUuid) => { calls.push(`unknown:${chatUuid}`); throw new Error("private recovery failure"); },
      { reserve: (chatUuid) => { calls.push(`reserve:${chatUuid}`); return "recovery_reserved"; } }
    ),
    (error: unknown) => error instanceof Error &&
      error.message === "The video generation may have been dispatched; do not retry automatically." &&
      "recovery_id" in error && error.recovery_id === "recovery_reserved"
  );
  assert.deepEqual(calls, ["reserve:video-chat-test", "dispatch", "unknown:video-chat-test"]);
});

test("owner video does not dispatch when recovery reservation fails", async () => {
  let startCalls = 0;
  let deleteCalls = 0;
  const client: OwnerVideoChatClient = {
    ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
    async startVideo() { startCalls += 1; return { chat_uuid: "video-chat-test", message_id: "echo" }; },
    async deleteChat(chat_uuid) { deleteCalls += 1; return { chat_uuid, accepted: true }; }
  };
  await assert.rejects(generateOneOwnerVideoForModel(client, "seedance-2.0", "x", undefined, instant, undefined, {
    reserve() { throw new Error("private reservation failure"); }
  }));
  assert.equal(startCalls, 0);
  assert.equal(deleteCalls, 1);
});

test("owner video checks the aborted polling deadline before constructing a GET", async () => {
  const controller = new AbortController();
  let listCalls = 0;
  const client: OwnerVideoChatClient = {
    ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
    async startVideo(request) {
      controller.abort();
      return { chat_uuid: request.chat_id, message_id: "echo" };
    },
    async listInProgress() { listCalls += 1; return []; }
  };
  await assert.rejects(generateOneOwnerVideoForModel(client, "seedance-2.0", "x", controller.signal, instant));
  assert.equal(listCalls, 0);
});

test("owner video converts polling abort to unknown and retains the reserved handle", async () => {
  const controller = new AbortController();
  const recoveryStore = new OwnerVideoRecoveryStore();
  let recoveryId = "";
  let startCalls = 0;
  let deleteCalls = 0;
  let listCalls = 0;
  const getMessageIds: string[] = [];
  const client: OwnerVideoChatClient = {
    ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
    async startVideo(request) { startCalls += 1; return { chat_uuid: request.chat_id, message_id: "echo-video" }; },
    async listInProgress() { listCalls += 1; return [{ message_id: "bot-video", message_object_id: "obj", object_type: "video", model_type: "seedance-2.0" }]; },
    async getMessage(chatUuid, messageId) {
      getMessageIds.push(messageId);
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "video", model_type: "seedance-2.0", artifacts: messageId === "bot-video" ? [{ url: "https://r2.syntx.ai/recovered.mp4", mime_type: "video/mp4" }] : [] };
    },
    async deleteChat(chat_uuid) { deleteCalls += 1; return { chat_uuid, accepted: true }; }
  };
  await assert.rejects(
    generateOneOwnerVideoForModel(
      client,
      "seedance-2.0",
      "x",
      controller.signal,
      async () => { controller.abort(); },
      () => recoveryId,
      {
        reserve: (chatUuid, modelId) => {
          recoveryId = recoveryStore.create({ attempt_id: ATTEMPT, chat_uuid: chatUuid, model_id: modelId }).recovery_id;
          return recoveryId;
        },
        updateMessageId: (id, messageId) => recoveryStore.updateMessageId(id, ATTEMPT, messageId),
        remove: (id) => recoveryStore.remove(id, ATTEMPT)
      }
    ),
    (error: unknown) => error instanceof Error && error.message === "The video generation may have been dispatched; do not retry automatically." &&
      "recovery_id" in error && error.recovery_id === recoveryId
  );
  assert.equal(startCalls, 1);
  assert.equal(deleteCalls, 0);
  const record = recoveryStore.get(recoveryId, ATTEMPT);
  assert.equal(record?.message_id, "bot-video");
  assert.deepEqual(await reconcileOwnerVideoRecovery(client, record!), [{ url: "https://r2.syntx.ai/recovered.mp4", mime_type: "video/mp4" }]);
  assert.deepEqual(getMessageIds, ["bot-video"]);
  assert.equal(listCalls, 1);
  recoveryStore.close();
});

test("owner video keeps dispatch recovery if bot message id persistence fails", async () => {
  const recoveryStore = new OwnerVideoRecoveryStore();
  let recoveryId = "";
  let startCalls = 0;
  let deleteCalls = 0;
  const client: OwnerVideoChatClient = {
    ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
    async startVideo(request) { startCalls += 1; return { chat_uuid: request.chat_id, message_id: "echo-video" }; },
    async listInProgress() { return [{ message_id: "bot-video", message_object_id: "obj", object_type: "video", model_type: "seedance-2.0" }]; },
    async deleteChat(chat_uuid) { deleteCalls += 1; return { chat_uuid, accepted: true }; }
  };
  await assert.rejects(
    generateOneOwnerVideoForModel(
      client,
      "seedance-2.0",
      "x",
      undefined,
      instant,
      () => recoveryId,
      {
        reserve: (chatUuid, modelId) => {
          recoveryId = recoveryStore.create({ attempt_id: ATTEMPT, chat_uuid: chatUuid, model_id: modelId }).recovery_id;
          return recoveryId;
        },
        updateMessageId: (id, messageId) => {
          if (messageId === "bot-video") throw new Error("private store failure");
          recoveryStore.updateMessageId(id, ATTEMPT, messageId);
        }
      }
    ),
    (error: unknown) => error instanceof Error && error.message === "The video generation may have been dispatched; do not retry automatically." &&
      "recovery_id" in error && error.recovery_id === recoveryId
  );
  assert.equal(startCalls, 1);
  assert.equal(deleteCalls, 0);
  assert.equal(recoveryStore.get(recoveryId, ATTEMPT)?.message_id, "echo-video");
  recoveryStore.close();
});

test("owner video tool rejects unsupported Luma variant before client resolution", async () => {
  let resolved = false;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => { resolved = true; return fakeClient({ final: "https://r2.syntx.ai/x.mp4" }); }, wait: instant } });
  const client = new Client({ name: "video-luma-reject", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try { const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "ray-3.14-i2v", prompt: "x", copies: 1 } }); assert.equal(result.isError, true); assert.equal(resolved, false); }
  finally { await client.close(); await server.close(); }
});

test("owner video tool rejects unsupported Sora variant before client resolution", async () => {
  let resolved = false;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => { resolved = true; return fakeClient({ final: "https://r2.syntx.ai/x.mp4" }); }, wait: instant } });
  const client = new Client({ name: "video-sora-reject", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try { const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "sora_1-i2v", prompt: "x", copies: 1 } }); assert.equal(result.isError, true); assert.equal(resolved, false); }
  finally { await client.close(); await server.close(); }
});

test("owner video tool rejects unsupported Wan variant before client resolution", async () => {
  let resolved = false;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => { resolved = true; return fakeClient({ final: "https://r2.syntx.ai/x.mp4" }); }, wait: instant } });
  const client = new Client({ name: "video-wan-reject", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try { const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "wan_27_i2v", prompt: "x", copies: 1 } }); assert.equal(result.isError, true); assert.equal(resolved, false); }
  finally { await client.close(); await server.close(); }
});

test("owner video tool rejects unsupported Wan 2.6 variant before client resolution", async () => {
  let resolved = false;
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => { resolved = true; return fakeClient({ final: "https://r2.syntx.ai/x.mp4" }); }, wait: instant } });
  const client = new Client({ name: "video-wan-26-reject", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try { const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "wan_26_i2v", prompt: "x", copies: 1 } }); assert.equal(result.isError, true); assert.equal(resolved, false); }
  finally { await client.close(); await server.close(); }
});

test("owner video unknown dispatch outcome leaves chat and reports error", async () => {
  let deleted = false;
  const clientImpl = fakeClient({ rejectDispatch: true });
  const client: OwnerVideoChatClient = { ...clientImpl, async deleteChat(uuid) { deleted = true; return clientImpl.deleteChat(uuid); } };
  await assert.rejects(import("../src/application/owner-generate-video.js").then(({ generateOneOwnerVideo }) => generateOneOwnerVideo(client, "x", undefined, instant)), /do not retry automatically/u);
  assert.equal(deleted, false);
});

test("owner video tool returns a fixed unknown-outcome response after dispatch", async () => {
  const recoveryStore = new OwnerVideoRecoveryStore();
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: { resolveChatClient: () => fakeClient({ rejectDispatch: true }), wait: instant, recoveryStore } });
  const client = new Client({ name: "video-unknown", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, prompt: "A cinematic city at sunset", copies: 1 } });
    assert.equal(result.isError, true);
    const text = (result as unknown as CallToolResult).content.find((item) => item.type === "text");
    assert.equal(text?.type, "text");
    const payload = JSON.parse(text.text) as { error: { code: string; message: string; recovery_id: string } };
    assert.equal(payload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(payload.error.message, "The video generation may have been dispatched; use the recovery tool before retrying.");
    assert.match(payload.error.recovery_id, /^recovery_[0-9a-f-]{36}$/u);
    assert.equal(JSON.stringify(result).includes("video-chat-test"), false);
    assert.equal(recoveryStore.get(payload.error.recovery_id, ATTEMPT)?.message_id, null);
  } finally { await client.close(); await server.close(); recoveryStore.close(); }
});

test("owner video tool hides recovery reservation errors and skips paid dispatch", async () => {
  let startCalls = 0;
  const server = createMcpServer(createDefaultApplication(), {
    ownerGenerateVideo: {
      resolveChatClient: () => ({
        ...fakeClient({ final: "https://r2.syntx.ai/generated/unused.mp4" }),
        async startVideo() { startCalls += 1; return { chat_uuid: "video-chat-test", message_id: "echo" }; }
      }),
      wait: instant,
      recoveryStore: {
        create(input) { throw new Error(`private recovery failure ${input.chat_uuid}`); },
        get() { return undefined; }
      }
    }
  });
  const client = new Client({ name: "video-reservation-failure", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, prompt: "x", copies: 1 } });
    const serialized = JSON.stringify(result);
    assert.equal(result.isError, true);
    assert.equal(startCalls, 0);
    assert.equal(serialized.includes("video-chat-test"), false);
    assert.equal(serialized.includes("private recovery failure"), false);
  } finally { await client.close(); await server.close(); }
});

test("owner video accepts only expected Seedance MP4 artifacts", async () => {
  for (const options of [
    { objectType: "image" },
    { modelType: "seedance-1.5-pro" },
    { mimeType: "image/png" }
  ]) {
    await assert.rejects(
      generateOneOwnerVideoForModel(fakeClient({ final: "https://r2.syntx.ai/generated/not-accepted.mp4", ...options }), "seedance-2.0", "x", undefined, instant),
      (error: unknown) => error instanceof Error && error.message === "The video generation may have been dispatched; do not retry automatically."
    );
  }
});

test("owner video performs two bounded terminal reconciliation reads before unknown outcome", async () => {
  let listReads = 0;
  let messageReads = 0;
  const client: OwnerVideoChatClient = {
    async createChat() { return { chat_uuid: "video-chat-reconcile" }; },
    async deleteChat() { return { chat_uuid: "video-chat-reconcile", accepted: true }; },
    async startVideo() { return { chat_uuid: "video-chat-reconcile", message_id: "echo-video" }; },
    async listInProgress() {
      listReads += 1;
      return listReads === 1 ? [{ message_id: "bot-video", message_object_id: "obj", object_type: "video", model_type: "seedance-2.0" }] : [];
    },
    async getMessage() {
      messageReads += 1;
      return { chat_uuid: "video-chat-reconcile", message_id: "bot-video", object_type: "video", model_type: "seedance-2.0", artifacts: [] };
    }
  };
  await assert.rejects(generateOneOwnerVideoForModel(client, "seedance-2.0", "x", undefined, instant), /do not retry automatically/u);
  // One terminal read plus two reconciliation reads; no retry/post occurs.
  assert.equal(messageReads, 3);
});
