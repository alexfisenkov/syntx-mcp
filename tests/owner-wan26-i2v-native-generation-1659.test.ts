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
import { OwnerWan26I2vNativeError } from "../src/adapter/syntx/owner-wan26-i2v-native-context.js";
import { OwnerWan26I2vReferenceService } from "../src/application/owner-wan26-i2v-reference-service.js";
import { createOwnerWan26I2vRequestPreparer } from "../src/application/owner-wan26-i2v-request-preparer.js";
import { createOwnerWan26I2vOneShotPermit, revalidateOwnerWan26I2vOneShotPermit } from "../src/application/owner-wan26-i2v-one-shot-policy.js";

const exec = promisify(execFile);
const MODEL_IDS = ["wan_26_i2v", "wan_26_i2v_flash"] as const;
const ATTEMPT = "link_wan26_native_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan26-native-test", subject: "owner" });
const MEDIA = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64"); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function json(value: unknown): Response { return Response.json(value); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>): Promise<T> { return fn("wan26-native-test-token"); } }; }

test("WAN 2.6 native POST and retained exact history/result GET survive candidate expiry", async (t) => {
  if (!MEDIA) { t.skip("supported local ffmpeg/ffprobe pair is unavailable"); return; }
  try { await exec(MEDIA.ffmpeg, ["-version"]); await exec(MEDIA.ffprobe, ["-version"]); }
  catch { t.skip("supported local ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-native-1659-"));
  const mp3Path = join(directory, "tone.mp3"), wavPath = join(directory, "tone.wav");
  await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
    "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", mp3Path]);
  await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=3.4",
    "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le", wavPath]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("GLOBAL_FETCH_FALLBACK_USED"); }) as typeof fetch;
  try {
    for (const model_id of MODEL_IDS) for (const includeAudio of [false, true]) {
      let now = 1_000, serial = 0, createRequests = 0, generationRequests = 0, historyRequests = 0, resultRequests = 0;
      let generationBody: Record<string, any> | undefined, chatUuid = "", ownerMessage = "", prompt = "";
      let historyObjectIds = ["video-object"];
      const provider: AuthLinkProvider = {
        authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
        async createChallenge() { return { upstream_attempt_id: `native-${serial++}`, approval_url: "https://example.invalid" }; },
        async pollChallenge(_challenge, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
      };
      const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), {
        now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
      });
      await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
      const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl: async (input, init) => {
        const url = new URL(String(input)), method = init?.method ?? "GET";
        if (url.pathname.endsWith("/chats/upload-files")) {
          assert.equal(method, "POST"); const form = init?.body; assert.ok(form instanceof FormData);
          const file = form.get("files"); assert.ok(file instanceof File);
          const model = form.get("model_type"); assert.equal(model, model_id);
          const media = file.type.startsWith("image/") ? "image" : "audio", id = `upload-${++serial}`;
          return json({ files: [{ id, url: `https://r2.syntx.ai/wan26/${id}.${file.name.endsWith(".mp3") ? "mp3" : file.name.endsWith(".wav") ? "wav" : "png"}`,
            filename: file.name, mime_type: file.type, content_type: file.type, media_type: media, type: media, size: file.size, status: "uploaded" }] });
        }
        if (url.pathname === "/api/v1/chats" && method === "POST") {
          createRequests += 1; const body = JSON.parse(String(init?.body)); assert.equal(body.scope, "video");
          assert.match(body.title, /^owner-wan26-i2v-/u); assert.equal(body.title.includes(prompt), false);
          chatUuid = `native-chat-${createRequests}`; return json({ uuid: chatUuid });
        }
        if (url.pathname.endsWith("/api/v1/video/generate")) {
          generationRequests += 1; assert.equal(method, "POST"); assert.ok(generationRequests === 1);
          assert.equal(url.searchParams.get("ai_name"), "wan_video");
          const body = JSON.parse(String(init?.body)); generationBody = body; prompt = body.prompt; ownerMessage = "owner-echo";
          return Promise.reject(new Error("simulated lost acknowledgement after accepted POST"));
        }
        if (url.pathname === `/api/v1/chats/${chatUuid}/messages` && method === "GET") {
          historyRequests += 1; const model = generationBody!.settings.model_type;
          return json({ messages: [
            { id: ownerMessage, chat_id: 4242, author_id: 7, message_object: [{ id: "owner-text", message_id: ownerMessage,
              object_type: "text", model_type: model, object_text: prompt }] },
            { id: "bot-message", chat_id: 4242, author_id: -1, message_object: historyObjectIds.map((id) => ({ id, message_id: "bot-message",
              object_type: "video", model_type: model, completed: true })) }
          ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
        }
        if (url.pathname === `/api/v1/chats/${chatUuid}/bot-message` && method === "GET") {
          resultRequests += 1;
          return json({ id: "bot-message", chat_id: 4242, author_id: -1, message_object: historyObjectIds.map((id) => ({ id, message_id: "bot-message",
            object_type: "video", model_type: generationBody!.settings.model_type, completed: true,
            object_url: `https://r2.syntx.ai/wan26/${id}.mp4` })) });
        }
        throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${method} ${url.pathname}`);
      } });
      const referenceService = new OwnerWan26I2vReferenceService({ binding: BINDING, linkService: links,
        resolveClient: async () => client, ffprobePath: MEDIA.ffprobe, now: () => now });
      const preparer = createOwnerWan26I2vRequestPreparer({ referenceService, now: () => now });
      const image = png384(); let audioBytes: Buffer | undefined;
      try {
        const imageInput = (filename: string) => referenceService.uploadImage({ attemptId: ATTEMPT, model_id, filename,
          mime_type: "image/png", content_base64: image.toString("base64") });
        const imageReceipt = await imageInput("start.png");
        let audioHandle: string | null = null;
        if (includeAudio) {
          const audioPath = model_id === "wan_26_i2v" ? mp3Path : wavPath;
          const filename = model_id === "wan_26_i2v" ? "tone.mp3" : "tone.wav";
          const mime_type = model_id === "wan_26_i2v" ? "audio/mp3" : "audio/wav";
          audioBytes = await readFile(audioPath);
          const receipt = await referenceService.uploadAudio({ attemptId: ATTEMPT, model_id, filename, mime_type,
            content_base64: audioBytes.toString("base64") }); audioHandle = receipt.audio_handle;
        }
        const candidate = await preparer.prepare({ attempt_id: ATTEMPT, model_id, image_handle: imageReceipt.image_handle,
          audio_handle: audioHandle, prompt: "A quiet cinematic scene.", parameters: { resolution: "1080P", aspect_ratio: "16:9",
            video_duration: 5, prompt_extend: true, seed: 0, native_audio: model_id === "wan_26_i2v_flash" } });
        prompt = preparer.getPrivateRequest(candidate).prompt;
        const binding = preparer.inspectCandidate(candidate)!;
        const permit = await createOwnerWan26I2vOneShotPermit({ preparer, candidate, principal: binding.principal, attemptId: ATTEMPT });
        const operation = Object.freeze({ preparer, candidate, permit, principal: binding.principal, attemptId: ATTEMPT, linkService: links, binding: BINDING });
        const chat = await client.createOwnerWan26I2vChat(operation);
        assert.equal(chat.model_id, model_id); assert.equal(chat.dispatch_allowed, false); assert.equal(chat.backend_acceptance, "UNPROVEN");
        assert.equal(JSON.stringify(chat).includes("https://"), false); assert.equal(createRequests, 1);
        const forgedCandidate = Object.freeze({ ...candidate, model_id: model_id === MODEL_IDS[0] ? MODEL_IDS[1] : MODEL_IDS[0] });
        await assert.rejects(client.createOwnerWan26I2vChat({ ...operation, candidate: forgedCandidate }));
        const overriddenClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("unexpected"); } });
        Object.defineProperty(overriddenClient, "uploadWan26I2vAudio", { value: async () => { throw new Error("override"); } });
        await assert.rejects(overriddenClient.createOwnerWan26I2vChat(operation));
        await revalidateOwnerWan26I2vOneShotPermit({ permit, preparer, candidate, principal: binding.principal, attemptId: ATTEMPT });
        await assert.rejects(client.startOwnerWan26I2vWithOwnedCandidate({ ...operation, chat }),
          (error: unknown) => error instanceof OwnerWan26I2vNativeError && error.code === "OUTCOME_UNKNOWN");
        assert.equal(generationRequests, 1); assert.equal(generationBody!.chat_id, chat.chat_uuid);
        assert.equal(generationBody!.settings.model_type, model_id); assert.equal(generationBody!.settings.video_duration, 5);
        assert.equal(Object.hasOwn(generationBody!.settings, "duration"), false);
        assert.deepEqual(generationBody!.settings.file_urls.map((item: { type: string }) => item.type), includeAudio ? ["image", "audio"] : ["image"]);
        assert.equal(JSON.stringify(candidate).includes("https://"), false);
        const forgedChat = Object.freeze({ ...chat });
        await assert.rejects(client.listOwnedWan26I2vCandidates({ ...operation, chat: forgedChat }));
        await assert.rejects(client.startOwnerWan26I2vWithOwnedCandidate({ ...operation, chat }));
        now += 16 * 60_000;
        const nextImage = await imageInput("prune.png");
        await preparer.prepare({ attempt_id: ATTEMPT, model_id, image_handle: nextImage.image_handle, audio_handle: null,
          prompt: "Pruning candidate.", parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 2,
            prompt_extend: false, seed: null, native_audio: model_id === "wan_26_i2v_flash" } });
        assert.equal(preparer.inspectCandidate(candidate), undefined);
        const listing = await client.listOwnedWan26I2vCandidates({ ...operation, chat });
        assert.equal(listing.owner_ack_status, "MATCHED"); assert.equal(listing.history_binding_status, "BOUND");
        assert.equal(listing.history_page_status, "COMPLETE"); assert.equal(listing.backend_acceptance, "UNPROVEN");
        assert.equal(listing.contexts.length, 1); assert.equal(historyRequests, 1);
        const context = listing.contexts[0]!;
        await assert.rejects(client.getOwnedWan26I2vResult({ ...operation, context: Object.freeze({ ...context }) }));
        await assert.rejects(client.listOwnedWan26I2vCandidates({ ...operation, attemptId: "link_other_native_owner_0123456789", chat }));
        const result = await client.getOwnedWan26I2vResult({ ...operation, context });
        assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
        assert.equal(result.ready_videos.length, 1); assert.equal(result.provider_terminal_status, "UNPROVEN");
        assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(resultRequests, 1);
        historyObjectIds = ["video-object", "video-object-2"];
        const grown = await client.listOwnedWan26I2vCandidates({ ...operation, chat });
        assert.equal(grown.contexts.length, 1); assert.deepEqual(grown.contexts[0]!.message_object_ids, historyObjectIds);
        await assert.rejects(client.getOwnedWan26I2vResult({ ...operation, context }));
        const grownContext = grown.contexts[0]!;
        assert.equal((await client.getOwnedWan26I2vResult({ ...operation, context: grownContext })).ready_videos.length, 2);
        historyObjectIds = ["video-object-2", "video-object"];
        const reordered = await client.listOwnedWan26I2vCandidates({ ...operation, chat });
        assert.equal(reordered.contexts.length, 0); assert.ok(reordered.gaps.includes("RESULT_CONTEXT_MISMATCH"));
        await assert.rejects(client.getOwnedWan26I2vResult({ ...operation, context: grownContext }));
        historyObjectIds = ["video-object", "video-object-2"];
        const restored = await client.listOwnedWan26I2vCandidates({ ...operation, chat });
        assert.equal(restored.contexts.length, 1);
        const otherClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("unexpected"); } });
        await assert.rejects(otherClient.getOwnedWan26I2vResult({ ...operation, context: restored.contexts[0]! }));
        await links.revoke(BINDING, ATTEMPT);
        await assert.rejects(client.getOwnedWan26I2vResult({ ...operation, context: restored.contexts[0]! }));
        assert.equal(resultRequests, 2);
      } finally {
        audioBytes?.fill(0); image.fill(0); await preparer.close(); await referenceService.close();
      }
    }
  } finally {
    globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true });
  }
});

async function createNativeRaceRig(fetchImpl: typeof fetch) {
  let now = 1_000, serial = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `native-race-${serial++}`, approval_url: "https://example.invalid" }; },
    async pollChallenge(_challenge, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl });
  const referenceService = new OwnerWan26I2vReferenceService({ binding: BINDING, linkService: links,
    resolveClient: async () => client, ffprobePath: MEDIA?.ffprobe ?? "/opt/homebrew/bin/ffprobe", now: () => now });
  const preparer = createOwnerWan26I2vRequestPreparer({ referenceService, now: () => now });
  return { client, links, referenceService, preparer, close: async () => { await preparer.close(); await referenceService.close(); } };
}

async function createNativeOperation(rig: Awaited<ReturnType<typeof createNativeRaceRig>>, filename: string, prompt: string) {
  const bytes = png384();
  const receipt = await rig.referenceService.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_i2v", filename,
    mime_type: "image/png", content_base64: bytes.toString("base64") });
  bytes.fill(0);
  const candidate = await rig.preparer.prepare({ attempt_id: ATTEMPT, model_id: "wan_26_i2v", image_handle: receipt.image_handle,
    audio_handle: null, prompt, parameters: { resolution: "1080P", aspect_ratio: "16:9", video_duration: 5,
      prompt_extend: true, seed: 0, native_audio: false } });
  const binding = rig.preparer.inspectCandidate(candidate)!;
  const permit = await createOwnerWan26I2vOneShotPermit({ preparer: rig.preparer, candidate, principal: binding.principal, attemptId: ATTEMPT });
  return Object.freeze({ preparer: rig.preparer, candidate, permit, principal: binding.principal,
    attemptId: ATTEMPT, linkService: rig.links, binding: BINDING });
}

test("same WAN 2.6 candidate cannot create a second chat before its permit is consumed", async () => {
  let createRequests = 0, loseNextCreateAck = false;
  const rig = await createNativeRaceRig(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) {
      const form = init?.body; assert.ok(form instanceof FormData); const file = form.get("files"); assert.ok(file instanceof File);
      return json({ files: [{ id: "img", url: "https://r2.syntx.ai/race/image.png", filename: file.name,
        mime_type: file.type, content_type: file.type, media_type: "image", type: "image", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      createRequests += 1;
      if (loseNextCreateAck) { loseNextCreateAck = false; throw new Error("simulated lost chat-create acknowledgement"); }
      return json({ uuid: `duplicate-chat-${createRequests}` });
    }
    throw new Error(`UNEXPECTED_RACE_FIXTURE ${init?.method} ${url.pathname}`);
  });
  try {
    const operation = await createNativeOperation(rig, "same.png", "Keep this native create single-use.");
    const first = await rig.client.createOwnerWan26I2vChat(operation);
    assert.equal(first.status, "created"); assert.equal(createRequests, 1);
    await assert.rejects(rig.client.createOwnerWan26I2vChat(operation),
      (error: unknown) => error instanceof OwnerWan26I2vNativeError && error.code === "CHAT_ALREADY_CREATED");
    assert.equal(createRequests, 1);
    const lostOperation = await createNativeOperation(rig, "lost.png", "Do not replay a possibly-created chat.");
    loseNextCreateAck = true;
    await assert.rejects(rig.client.createOwnerWan26I2vChat(lostOperation),
      (error: unknown) => error instanceof OwnerWan26I2vNativeError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(createRequests, 2);
    await assert.rejects(rig.client.createOwnerWan26I2vChat(lostOperation),
      (error: unknown) => error instanceof OwnerWan26I2vNativeError && error.code === "CHAT_ALREADY_CREATED");
    assert.equal(createRequests, 2);
  } finally { await rig.close(); }
});

test("concurrent first WAN 2.6 chats on one client retain both states and each start once", async () => {
  let createRequests = 0, generationRequests = 0, releaseCreateGate!: () => void;
  const bothCreatesAtHttp = new Promise<void>((resolve) => { releaseCreateGate = resolve; });
  const rig = await createNativeRaceRig(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) {
      const form = init?.body; assert.ok(form instanceof FormData); const file = form.get("files"); assert.ok(file instanceof File);
      return json({ files: [{ id: `img-${file.name}`, url: `https://r2.syntx.ai/race/${file.name}`,
        filename: file.name, mime_type: "image/png", content_type: "image/png", media_type: "image", type: "image", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      const id = ++createRequests; if (id === 2) releaseCreateGate(); await bothCreatesAtHttp;
      return json({ uuid: `parallel-chat-${id}` });
    }
    if (url.pathname.endsWith("/api/v1/video/generate") && init?.method === "POST") {
      generationRequests += 1; const body = JSON.parse(String(init?.body));
      return json({ id: `parallel-message-${body.chat_id}` });
    }
    throw new Error(`UNEXPECTED_RACE_FIXTURE ${init?.method} ${url.pathname}`);
  });
  try {
    const [firstOperation, secondOperation] = await Promise.all([
      createNativeOperation(rig, "first.png", "First distinct native intent."),
      createNativeOperation(rig, "second.png", "Second distinct native intent.")
    ]);
    const chats = await Promise.all([rig.client.createOwnerWan26I2vChat(firstOperation), rig.client.createOwnerWan26I2vChat(secondOperation)]);
    assert.equal(createRequests, 2); assert.notEqual(chats[0]!.chat_uuid, chats[1]!.chat_uuid);
    const starts = await Promise.allSettled([
      rig.client.startOwnerWan26I2vWithOwnedCandidate({ ...firstOperation, chat: chats[0]! }),
      rig.client.startOwnerWan26I2vWithOwnedCandidate({ ...secondOperation, chat: chats[1]! })
    ]);
    assert.deepEqual(starts.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.equal(generationRequests, 2);
    await Promise.all([
      assert.rejects(rig.client.startOwnerWan26I2vWithOwnedCandidate({ ...firstOperation, chat: chats[0]! })),
      assert.rejects(rig.client.startOwnerWan26I2vWithOwnedCandidate({ ...secondOperation, chat: chats[1]! }))
    ]);
    assert.equal(generationRequests, 2);
  } finally { await rig.close(); }
});
