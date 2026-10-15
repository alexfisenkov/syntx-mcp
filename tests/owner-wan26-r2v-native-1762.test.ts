import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  closeOwnerWan26R2vNativeContextsForClient,
  invalidateOwnerWan26R2vNativeAttempt,
  OwnerWan26R2vNativeError,
  type OwnerWan26R2vNativeOperationInput
} from "../src/adapter/syntx/owner-wan26-r2v-native-context.js";
import { createOwnerWan26R2vOneShotPermit } from "../src/application/owner-wan26-r2v-one-shot-policy.js";
import { OwnerWan26R2vReferenceService } from "../src/application/owner-wan26-r2v-reference-service.js";
import { createOwnerWan26R2vRequestPreparer } from "../src/application/owner-wan26-r2v-request-preparer.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";

const ATTEMPT = "link_wan26_r2v_native_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan26-native-1762", subject: "owner" });
const TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((item) => existsSync(item.ffmpeg) && existsSync(item.ffprobe));
const run = promisify(execFile);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
type Model = "wan_26_r2v" | "wan_26_r2v_flash";
const CHAT_IDS = Array.from({ length: 129 }, (_, index) => `wan26-native-chat-${index}`);
const prompts = Array.from({ length: CHAT_IDS.length }, (_, index) => `wan26 prompt ${index}\nsecond line ${index}`);
prompts[0] = "line one\nline two: keep the exact spacing";
prompts[1] = "flash prompt\nsecond line";
prompts[2] = "unknown ack recovery\nkeep this line";
const models: readonly Model[] = CHAT_IDS.map((_, index) => index === 1 || index === 3 ? "wan_26_r2v_flash" : "wan_26_r2v");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function image384(): Buffer {
  const bytes = Buffer.from(PNG);
  bytes.writeUInt32BE(384, 16);
  bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function broker(): SyntxCredentialBroker {
  return {
    async useCredential<T>(use: (credential: string) => Promise<T>) {
      return use("synthetic-native-credential");
    }
  };
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof Error && "code" in error && error.code === code;
}
async function linked(now: { value: number }): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "native-1762", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now.value), {
    now: () => now.value,
    defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT
  });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT); return links;
}
function parameters(model: Model) { return { resolution: "1080P", aspect_ratio: "16:9", video_duration: 6 as const, seed: 17,
  ...(model === "wan_26_r2v_flash" ? { native_audio: false } : {}) }; }

test("native WAN26 R2V preserves exact mixed requests for both models and recovers only through owned GETs", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "wan26-r2v-native-1762-"));
  const now = { value: 1_000 };
  const image = image384(); let videoBytes: Uint8Array | undefined;
  const counts = { chats: 0, posts: 0, histories: 0, results: 0 };
  const posted: Record<string, any>[] = [];
  const chatFixtures = new Map<string, { model: Model; prompt: string }>();
  const acknowledgements = new Map<string, string>();
  const handles = new Map<Model, readonly [string, string]>();
  const durations = new Map<Model, number>();
  let loseNextAck = false;
  let holdChatCreates = false;
  let chatCreateArrivals = 0;
  let signalBothChatCreates!: () => void;
  let bothChatCreatesEntered = Promise.resolve();
  let releaseChatCreates!: () => void;
  let chatCreateGate = Promise.resolve();
  const beginHoldingPair = () => {
    chatCreateArrivals = 0;
    bothChatCreatesEntered = new Promise<void>((resolve) => { signalBothChatCreates = resolve; });
    chatCreateGate = new Promise<void>((resolve) => { releaseChatCreates = resolve; });
    holdChatCreates = true;
  };
  const linkService = await linked(now);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (method === "POST" && url.pathname.endsWith("/chats/upload-files")) {
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
      const video = file.type === "video/mp4";
      const mediaType = video ? "video" : "image";
      return response({ files: [{ id: `upload-${counts.chats}-${file.name}`, filename: file.name, url: `https://r2.syntx.ai/wan26/${file.name}`,
        mime_type: file.type, content_type: file.type, type: mediaType, media_type: mediaType, status: "uploaded", size: file.size }] });
    }
    if (method === "POST" && url.pathname.endsWith("/chats")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["title", "scope"]); assert.equal(body.scope, "video");
      assert.match(String(body.title), /^owner-wan26-r2v-[0-9a-f-]{36}$/u);
      const uuid = CHAT_IDS[counts.chats++]!;
      if (holdChatCreates) {
        chatCreateArrivals += 1;
        if (chatCreateArrivals === 2) signalBothChatCreates();
        await chatCreateGate;
      }
      return response({ uuid });
    }
    if (method === "POST" && url.pathname.endsWith("/video/generate")) {
      assert.equal(url.search, "?ai_name=wan_video");
      const body = JSON.parse(String(init?.body)) as Record<string, any>; posted.push(body); counts.posts += 1;
      const ack = `owner-ack-${counts.posts}`;
      acknowledgements.set(String(body.chat_id), ack);
      if (loseNextAck) { loseNextAck = false; throw new Error("synthetic transport loss after provider accepted the request"); }
      return response({ id: ack });
    }
    if (method === "GET" && url.pathname.endsWith("/messages")) {
      counts.histories += 1; const pathParts = url.pathname.split("/").filter(Boolean), index = CHAT_IDS.indexOf(pathParts.at(-2)!); assert.notEqual(index, -1);
      assert.equal(url.searchParams.get("page"), "1"); assert.equal(url.searchParams.get("page_size"), "10");
      const fixture = chatFixtures.get(pathParts.at(-2)!);
      const model = fixture?.model ?? models[index]!;
      const prompt = fixture?.prompt ?? prompts[index]!;
      const chatId = 77260 + index;
      const ack = acknowledgements.get(pathParts.at(-2)!) ?? `owner-ack-${index + 1}`;
      const message = `result-${index + 1}`;
      const object = `video-${index + 1}`;
      const rows = [
        {
          id: ack,
          chat_id: chatId,
          author_id: 21,
          message_object: [{ id: `${ack}-text`, message_id: ack, object_type: "text", model_type: model, object_text: prompt }]
        },
        {
          id: message,
          chat_id: chatId,
          author_id: -1,
          message_object: [{ id: object, message_id: message, object_type: "video", model_type: model, completed: true }]
        }
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length, total_pages: 1, has_next: false, has_previous: false },
        ...(index === 1 ? { new_provider_hint: "opaque" } : {}) });
    }
    if (method === "GET" && url.pathname.includes("/chats/") && !url.pathname.endsWith("/messages")) {
      counts.results += 1;
      const pathParts = url.pathname.split("/").filter(Boolean);
      const chatId = pathParts.at(-2)!;
      const index = CHAT_IDS.indexOf(chatId);
      assert.notEqual(index, -1);
      const model = chatFixtures.get(chatId)?.model ?? models[index]!;
      return response({ id: `result-${index + 1}`, chat_id: 77260 + index, author_id: -1, message_object: [
        { id: `video-${index + 1}`, message_id: `result-${index + 1}`, object_type: "video", model_type: model, completed: true,
          object_url: `https://r2.syntx.ai/wan26/results/${index}.mp4` }
      ] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  } });
  const referenceService = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService, resolveClient: () => client,
    ffmpegPath: TOOLS.ffmpeg, ffprobePath: TOOLS.ffprobe, now: () => now.value });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService, referenceService, now: () => now.value });
  try {
    await run(TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc=size=384x384:rate=24:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
      join(directory, "source.mp4")]);
    videoBytes = new Uint8Array(await readFile(join(directory, "source.mp4")));
    for (let index = 0; index < 2; index += 1) {
      const model = models[index]!;
      const imageReceipt = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: model,
        content_base64: image.toString("base64"), filename: `${model}.png`, mime_type: "image/png" });
      const videoReceipt = await referenceService.uploadSelectedVideo({ attemptId: ATTEMPT, model_id: model, content_base64: Buffer.from(videoBytes).toString("base64"),
        filename: `${model}.mp4`, mime_type: "video/mp4", start_seconds: 0, end_seconds: 0.8, total_reference_count: 2 });
      handles.set(model, [videoReceipt.reference_handle, imageReceipt.reference_handle]);
      durations.set(model, Math.round(videoReceipt.selected_duration_seconds! * 100) / 100);
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: model, prompt: prompts[index]!, parameters: parameters(model),
        reference_handles: [videoReceipt.reference_handle, imageReceipt.reference_handle] });
      const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
      const permit = await createOwnerWan26R2vOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
      const operation: OwnerWan26R2vNativeOperationInput = { preparer, candidate, permit, referenceService,
        principal, attemptId: ATTEMPT, linkService, binding: BINDING };
      await assert.rejects(client.createOwnerWan26R2vChat({ ...operation, candidate: { ...candidate } }), errorCode("CANDIDATE_INVALID"));
      const foreignPrincipal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: "another-owner", connection_id: ATTEMPT });
      await assert.rejects(client.createOwnerWan26R2vChat({ ...operation, principal: foreignPrincipal }), errorCode("PRINCIPAL_NOT_LINKED"));
      const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
        throw new Error("foreign client must not dispatch");
      } });
      await assert.rejects(foreignClient.createOwnerWan26R2vChat(operation), errorCode("CANDIDATE_INVALID"));
      closeOwnerWan26R2vNativeContextsForClient(foreignClient);
      await assert.rejects(foreignClient.createOwnerWan26R2vChat(operation), errorCode("CHAT_CONTEXT_INVALID"));
      const request = preparer.getPrivateRequest(candidate);
      assert.deepEqual(request.settings.file_urls.map((file) => file.type), ["video", "image"]);
      assert.equal(request.settings.duration, durations.get(model));
      assert.equal(request.prompt, prompts[index]);
      const chat = await client.createOwnerWan26R2vChat(operation);
      chatFixtures.set(chat.chat_uuid, { model, prompt: prompts[index]! });
      await assert.rejects(client.createOwnerWan26R2vChat(operation), errorCode("CHAT_ALREADY_CREATED"));
      assert.equal(counts.chats, index + 1, "a candidate creates at most one native chat");
      await assert.rejects(client.startOwnerWan26R2vWithOwnedCandidate({ ...operation, chat: { ...chat } }), errorCode("CHAT_CONTEXT_INVALID"));
      const ack = await client.startOwnerWan26R2vWithOwnedCandidate({ ...operation, chat });
      assert.equal(ack.chat_uuid, CHAT_IDS[index]); assert.equal(ack.message_id, `owner-ack-${index + 1}`);
      assert.equal(posted[index]?.chat_id, CHAT_IDS[index]); assert.equal(posted[index]?.prompt, prompts[index]);
      assert.equal(posted[index]?.settings.model_type, model);
      assert.deepEqual(posted[index]?.settings.file_urls.map((file: { type: string }) => file.type), ["video", "image"]);
      assert.equal(posted[index]?.settings.duration, durations.get(model)); assert.equal(posted[index]?.settings.video_duration, 6);
      assert.equal(Object.hasOwn(posted[index]?.settings ?? {}, "shot_type"), false);
      assert.equal(Object.hasOwn(posted[index]?.settings ?? {}, "audio_setting"), false);
      assert.equal(Object.hasOwn(posted[index]?.settings ?? {}, "prompt_extend"), false);
      assert.equal(Object.hasOwn(posted[index]?.settings ?? {}, "rendering_speed"), false);
      const history = await client.listOwnedWan26R2vCandidates(chat);
      assert.equal(history.status, "COMPLETE", JSON.stringify(history));
      assert.equal(history.owner_ack_status, "MATCHED");
      if (index === 1) {
        assert.equal(history.history_binding_status, "PARTIAL");
        assert.ok(history.gaps.includes("HISTORY_UNKNOWN_FIELDS"));
        assert.equal(history.contexts.length, 0, "unknown history metadata cannot mint result authority");
      } else {
        assert.equal(history.contexts.length, 1);
        await assert.rejects(client.getOwnedWan26R2vResult({ ...history.contexts[0]! }), errorCode("RESULT_CONTEXT_INVALID"));
        const result = await client.getOwnedWan26R2vResult(history.contexts[0]!);
        assert.equal(result.message_binding, "BOUND");
        assert.equal(result.model_echo, "MATCHED");
        assert.equal(result.result_status, "OBSERVED");
        assert.equal(result.ready_videos[0]?.object_url, `https://r2.syntx.ai/wan26/results/${index}.mp4`);
      }
    }
    const model = "wan_26_r2v" as const;
    const index = 2;
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: model, prompt: prompts[index]!,
      parameters: parameters(model), reference_handles: handles.get(model)! });
    const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
    const permit = await createOwnerWan26R2vOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
    const operation: OwnerWan26R2vNativeOperationInput = { preparer, candidate, permit, referenceService,
      principal, attemptId: ATTEMPT, linkService, binding: BINDING };
    const parallelIndex = 3;
    const parallelModel = "wan_26_r2v_flash" as const;
    const parallelCandidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: parallelModel, prompt: prompts[parallelIndex]!,
      parameters: parameters(parallelModel), reference_handles: handles.get(parallelModel)! });
    const parallelPermit = await createOwnerWan26R2vOneShotPermit({ preparer, candidate: parallelCandidate, principal, attemptId: ATTEMPT });
    const parallelOperation: OwnerWan26R2vNativeOperationInput = { preparer, candidate: parallelCandidate, permit: parallelPermit,
      referenceService, principal, attemptId: ATTEMPT, linkService, binding: BINDING };

    beginHoldingPair();
    const createUnknownChat = client.createOwnerWan26R2vChat(operation);
    const createParallelChat = client.createOwnerWan26R2vChat(parallelOperation);
    await bothChatCreatesEntered;
    releaseChatCreates();
    holdChatCreates = false;
    const [chat, parallelChat] = await Promise.all([createUnknownChat, createParallelChat]);
    chatFixtures.set(chat.chat_uuid, { model, prompt: prompts[index]! });
    chatFixtures.set(parallelChat.chat_uuid, { model: parallelModel, prompt: prompts[parallelIndex]! });
    assert.deepEqual(new Set([chat.chat_uuid, parallelChat.chat_uuid]), new Set(CHAT_IDS.slice(2, 4)));
    await assert.rejects(client.listOwnedWan26R2vCandidates(chat), errorCode("CHAT_NOT_DISPATCHED"));
    await assert.rejects(client.listOwnedWan26R2vCandidates(parallelChat), errorCode("CHAT_NOT_DISPATCHED"));

    loseNextAck = true;
    await assert.rejects(client.startOwnerWan26R2vWithOwnedCandidate({ ...operation, chat }), errorCode("OUTCOME_UNKNOWN"));
    assert.equal(counts.posts, 3);
    await assert.rejects(client.startOwnerWan26R2vWithOwnedCandidate({ ...operation, chat }), errorCode("OUTCOME_UNKNOWN"));
    assert.equal(counts.posts, 3, "an ambiguous POST is never retried");
    const history = await client.listOwnedWan26R2vCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED"); assert.equal(history.contexts.length, 1);

    for (let fillIndex = 4; fillIndex < 127; fillIndex += 1) {
      const fillCandidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: model, prompt: prompts[fillIndex]!,
        parameters: parameters(model), reference_handles: handles.get(model)! });
      const fillPermit = await createOwnerWan26R2vOneShotPermit({ preparer, candidate: fillCandidate, principal, attemptId: ATTEMPT });
      await client.createOwnerWan26R2vChat({ preparer, candidate: fillCandidate, permit: fillPermit, referenceService,
        principal, attemptId: ATTEMPT, linkService, binding: BINDING });
    }
    assert.equal(counts.chats, 127);

    const edgeCandidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: model, prompt: prompts[127]!,
      parameters: parameters(model), reference_handles: handles.get(model)! });
    const edgePermit = await createOwnerWan26R2vOneShotPermit({ preparer, candidate: edgeCandidate, principal, attemptId: ATTEMPT });
    const edgeOperation: OwnerWan26R2vNativeOperationInput = { preparer, candidate: edgeCandidate, permit: edgePermit,
      referenceService, principal, attemptId: ATTEMPT, linkService, binding: BINDING };
    const overflowPreparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService, referenceService, now: () => now.value });
    try {
      const overflowCandidate = await overflowPreparer.prepare({ attemptId: ATTEMPT, model_id: model, prompt: prompts[128]!,
        parameters: parameters(model), reference_handles: handles.get(model)! });
      const overflowPermit = await createOwnerWan26R2vOneShotPermit({ preparer: overflowPreparer, candidate: overflowCandidate,
        principal, attemptId: ATTEMPT });
      const overflowOperation: OwnerWan26R2vNativeOperationInput = { preparer: overflowPreparer, candidate: overflowCandidate,
        permit: overflowPermit, referenceService, principal, attemptId: ATTEMPT, linkService, binding: BINDING };

      beginHoldingPair();
      const lastAvailableCreate = client.createOwnerWan26R2vChat(edgeOperation);
      await new Promise<void>((resolve) => {
        const poll = () => chatCreateArrivals === 1 ? resolve() : setTimeout(poll, 0);
        poll();
      });
      await assert.rejects(client.createOwnerWan26R2vChat(overflowOperation), errorCode("CAPACITY_EXCEEDED"));
      releaseChatCreates();
      holdChatCreates = false;
      await lastAvailableCreate;
      assert.equal(counts.chats, 128, "pending creation reserves the final per-client slot");
    } finally {
      releaseChatCreates();
      holdChatCreates = false;
      await overflowPreparer.close();
    }

    now.value += 15 * 60_000 + 1;
    const recovered = await client.getOwnedWan26R2vResult(history.contexts[0]!);
    assert.equal(recovered.message_binding, "BOUND"); assert.equal(recovered.model_echo, "MATCHED");
    assert.equal(counts.posts, 3, "an expired prepared input authorizes no new generation POST");
    assert.equal(counts.results, 2, "same-owner result GET remains available after input TTL");
    await linkService.revoke(BINDING, ATTEMPT);
    await assert.rejects(client.getOwnedWan26R2vResult(history.contexts[0]!), errorCode("PRINCIPAL_NOT_LINKED"));
    invalidateOwnerWan26R2vNativeAttempt(client, ATTEMPT);
    await assert.rejects(client.listOwnedWan26R2vCandidates(chat), errorCode("CHAT_CONTEXT_INVALID"));
    closeOwnerWan26R2vNativeContextsForClient(client);
    await assert.rejects(client.createOwnerWan26R2vChat(operation), errorCode("CANDIDATE_INVALID"));
    assert.deepEqual(counts, { chats: 128, posts: 3, histories: 3, results: 2 });
  } catch (error) {
    if (error instanceof OwnerWan26R2vNativeError) throw error;
    throw error;
  } finally {
    releaseChatCreates();
    holdChatCreates = false;
    videoBytes?.fill(0); image.fill(0); await preparer.close(); await referenceService.close(); await rm(directory, { recursive: true, force: true });
  }
});
