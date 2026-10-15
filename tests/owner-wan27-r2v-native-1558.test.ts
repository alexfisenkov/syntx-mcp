import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient, consumeOwnerWan27R2vNativeInvocation } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  OwnerWan27R2vNativeError, type OwnerWan27R2vNativeOperationInput
} from "../src/adapter/syntx/owner-wan27-r2v-native-context.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";
import { releaseValidatedOwnerWan27R2vImage, validateOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import { createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "../src/application/owner-wan27-r2v-original-probe.js";
import { createOwnerWan27R2vVideoCropProcessor, releaseTrustedOwnerWan27R2vVideoCropReceipt } from "../src/application/owner-wan27-r2v-video-crop.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { OwnerWan27R2vReferenceService } from "../src/application/owner-wan27-r2v-reference-service.js";
import { createOwnerWan27R2vRequestPreparer } from "../src/application/owner-wan27-r2v-request-preparer.js";
import { createOwnerWan27R2vOneShotPermit } from "../src/application/owner-wan27-r2v-one-shot-policy.js";

const ATTEMPT = "link_wan27_native_owner_0123456789";
const OTHER = "link_wan27_native_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "wan27-native-tenant", subject: "wan27-native-owner" });
const CHAT = "wan27-native-chat";
const OWNER_ACK = "wan27-native-owner-ack";
const RESULT_MESSAGE = "wan27-native-result-message";
const RESULT_OBJECT = "wan27-native-video-object";
const RESULT_URL = "https://r2.syntx.ai/wan27/results/selected.mp4";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const run = promisify(execFile);
const MEDIA_TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));

interface NativeFixtureState {
  chatCreates: number;
  generationPosts: number;
  historyGets: number;
  resultGets: number;
  uploads: number;
  lastBody: Record<string, any> | undefined;
  loseNextAck: boolean;
  ackKnown: boolean;
  abortController: AbortController | undefined;
  abortAfterAckOnNextClockRead: boolean;
  onCreateChat: (() => Promise<void>) | undefined;
}
interface Harness {
  readonly now: { value: number };
  readonly links: PerUserLinkService;
  readonly references: OwnerWan27R2vReferenceService;
  readonly preparer: ReturnType<typeof createOwnerWan27R2vRequestPreparer>;
  readonly clients: Map<string, SyntxChatHttpClient>;
  readonly states: Map<string, NativeFixtureState>;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function imageBytes(): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function response(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-native-fixture-credential"); } }; }
async function linked(ids: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `native-fixture-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const service = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await service.createAttempt(BINDING); await service.issueHandoff(BINDING, id); await service.checkAttempt(BINDING, id); }
  return service;
}
function errorCode(code: string) { return (error: unknown) => error instanceof Error && "code" in error && error.code === code; }

async function harness(ids: readonly string[] = [ATTEMPT, OTHER]): Promise<Harness> {
  const now = { value: 1_000 }, states = new Map<string, NativeFixtureState>(), clients = new Map<string, SyntxChatHttpClient>();
  let links: PerUserLinkService | undefined;
  for (const id of ids) {
    const state: NativeFixtureState = { chatCreates: 0, generationPosts: 0, historyGets: 0, resultGets: 0, uploads: 0,
      lastBody: undefined, loseNextAck: false, ackKnown: false, abortController: undefined,
      abortAfterAckOnNextClockRead: false, onCreateChat: undefined };
    states.set(id, state);
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? "GET";
      if (method === "POST" && url.pathname.endsWith("/chats/upload-files")) {
        const form = init?.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
        state.uploads += 1;
        const extension = file.type === "video/mp4" ? "selected.mp4" : "image.png";
        const ownedUrl = `https://r2.syntx.ai/wan27/${id}/${extension}`;
        return response({ files: [{ id: `${id}-upload-${state.uploads}`, filename: file.name, url: ownedUrl,
          mime_type: file.type, content_type: file.type, size: file.size, ...(file.type === "video/mp4" ? { duration: 1 } : {}) }] });
      }
      if (method === "POST" && url.pathname.endsWith("/chats")) {
        state.chatCreates += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body), ["title", "scope"]); assert.equal(body.scope, "video");
        assert.match(String(body.title), /^owner-wan27-r2v-[0-9a-f-]{36}$/u);
        await state.onCreateChat?.();
        return response({ uuid: CHAT });
      }
      if (method === "POST" && url.pathname.endsWith("/video/generate")) {
        state.generationPosts += 1;
        assert.equal(url.search, "?ai_name=wan_video");
        state.lastBody = JSON.parse(String(init?.body)) as Record<string, any>;
        if (state.loseNextAck) { state.loseNextAck = false; return response({}); }
        state.ackKnown = true;
        if (state.abortController) state.abortAfterAckOnNextClockRead = true;
        return response({ id: OWNER_ACK });
      }
      if (method === "GET" && url.pathname.endsWith(`/chats/${CHAT}/messages`)) {
        state.historyGets += 1;
        const ownerAck = state.ackKnown;
        const rows = ownerAck ? [
          { id: OWNER_ACK, chat_id: 77202, author_id: 17, message_object: [] },
          { id: RESULT_MESSAGE, chat_id: 77202, author_id: -1, message_object: [
            { id: RESULT_OBJECT, message_id: RESULT_MESSAGE, object_type: "video", model_type: "wan_27_r2v" }
          ] }
        ] : [];
        const page = Number(url.searchParams.get("page")), pageSize = Number(url.searchParams.get("page_size"));
        assert.equal(page, 1); assert.equal(pageSize, 10);
        return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
          total_pages: rows.length === 0 ? 0 : 1, has_next: false, has_previous: false } });
      }
      if (method === "GET" && url.pathname.endsWith(`/chats/${CHAT}/${RESULT_MESSAGE}`)) {
        state.resultGets += 1;
        return response({ id: RESULT_MESSAGE, chat_id: 77202, author_id: -1, message_object: [
          { id: RESULT_OBJECT, message_id: RESULT_MESSAGE, object_type: "video", model_type: "wan_27_r2v",
            completed: true, object_url: RESULT_URL }
        ] });
      }
      throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
    } });
    clients.set(id, client);
  }
  const readNow = () => {
    for (const state of states.values()) if (state.abortAfterAckOnNextClockRead) {
      state.abortAfterAckOnNextClockRead = false;
      state.abortController?.abort();
    }
    return now.value;
  };
  links = await linked(ids, readNow);
  const references = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links,
    resolveClient: (attemptId: string) => clients.get(attemptId), now: readNow });
  const preparer = createOwnerWan27R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService: references, now: readNow });
  return { now, links, references, preparer, clients, states };
}

async function makeImageManifest(h: Harness, attemptId: string, count = 1) {
  const draft = await h.references.createManifest({ attemptId, video_reference_count: 0 });
  const bytes = imageBytes();
  for (let index = 0; index < count; index += 1) {
    const receipt = validateOwnerWan27R2vImage({ filename: "frame.png", mime_type: "image/png", bytes });
    try { await h.references.addImage({ manifest_handle: draft.manifest_handle, image: receipt }); }
    finally { releaseValidatedOwnerWan27R2vImage(receipt); }
  }
  bytes.fill(0);
  return h.references.finalizeManifest({ manifest_handle: draft.manifest_handle });
}
async function cropReceipt(): Promise<{ directory: string; original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>>;
  crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>> }> {
  if (!MEDIA_TOOLS) throw new Error("media_tools_unavailable");
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-native-1558-")), path = join(directory, "source.mp4");
  await run(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path]);
  const bytes = new Uint8Array(await readFile(path));
  const original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: MEDIA_TOOLS.ffprobe }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes });
  bytes.fill(0);
  const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 1 });
  const crop = await createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: MEDIA_TOOLS.ffmpeg, ffprobePath: MEDIA_TOOLS.ffprobe }).crop(original, selection);
  return { directory, original, crop };
}
async function makeMixedManifest(h: Harness, crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>>) {
  const draft = await h.references.createManifest({ attemptId: ATTEMPT, video_reference_count: 1 }), bytes = imageBytes();
  for (let index = 0; index < 2; index += 1) {
    const receipt = validateOwnerWan27R2vImage({ filename: "frame.png", mime_type: "image/png", bytes });
    try { await h.references.addImage({ manifest_handle: draft.manifest_handle, image: receipt }); }
    finally { releaseValidatedOwnerWan27R2vImage(receipt); }
  }
  bytes.fill(0); await h.references.addSelectedVideo({ manifest_handle: draft.manifest_handle, crop });
  return h.references.finalizeManifest({ manifest_handle: draft.manifest_handle });
}
async function operationFor(h: Harness, candidate: Awaited<ReturnType<typeof h.preparer.prepare>>, attemptId = ATTEMPT) {
  const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId });
  const permit = await createOwnerWan27R2vOneShotPermit({ preparer: h.preparer, candidate, principal, attemptId });
  return { preparer: h.preparer, candidate, permit, referenceService: h.references, principal, attemptId,
    linkService: h.links, binding: BINDING } satisfies OwnerWan27R2vNativeOperationInput;
}
function requestFor(attemptId: string, manifestHandle: string) {
  return { attemptId, manifest_handle: manifestHandle, model_id: "wan_27_r2v", prompt: "Keep each selected reference in order.", parameters: {
    resolution: "1080P", aspect_ratio: "16:9", video_duration: 2, prompt_extend: false, seed: null, native_audio: false
  } };
}

test("native R2V emits the exact mixed prepared DTO once, then binds ACK, history, and result GET after input TTL", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await run(MEDIA_TOOLS.ffmpeg, ["-version"]); await run(MEDIA_TOOLS.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const h = await harness(); let media: Awaited<ReturnType<typeof cropReceipt>> | undefined;
  try {
    const imageOnly = await makeImageManifest(h, ATTEMPT, 1), imageCandidate = await h.preparer.prepare(requestFor(ATTEMPT, imageOnly.manifest_handle));
    assert.equal(h.preparer.getPrivateRequest(imageCandidate).settings.duration, 0);
    assert.equal(h.preparer.getPrivateRequest(imageCandidate).settings.model_type, "wan_27_r2v");

    media = await cropReceipt(); const manifest = await makeMixedManifest(h, media.crop);
    const candidate = await h.preparer.prepare(requestFor(ATTEMPT, manifest.manifest_handle));
    const operation = await operationFor(h, candidate), client = h.clients.get(ATTEMPT)!;
    const prepared = h.preparer.getPrivateRequest(candidate);
    assert.equal(prepared.settings.file_urls.length, 2, "typed URL dedupe keeps one image and one video in source order");
    assert.deepEqual(prepared.settings.file_urls.map((file) => file.type), ["image", "video"]);
    assert.equal(prepared.settings.duration, 1); assert.equal(prepared.settings.video_duration, 2);
    const chat = await client.createOwnerWan27R2vChat(operation);
    assert.equal(chat.model_id, "wan_27_r2v"); assert.equal(chat.dispatch_allowed, false);
    const ack = await client.startOwnerWan27R2vWithOwnedCandidate({ ...operation, chat });
    assert.deepEqual(ack, { chat_uuid: CHAT, message_id: OWNER_ACK });
    assert.equal(h.states.get(ATTEMPT)?.chatCreates, 1); assert.equal(h.states.get(ATTEMPT)?.generationPosts, 1);
    assert.deepEqual(Object.keys(h.states.get(ATTEMPT)?.lastBody?.settings ?? {}).sort(),
      ["aspect_ratio", "audio_setting", "duration", "file_urls", "model_type", "native_audio", "prompt_extend", "resolution", "seed", "shot_type", "video_duration"].sort());
    assert.equal(h.states.get(ATTEMPT)?.lastBody?.settings.model_type, "wan_27_r2v");
    assert.equal(h.states.get(ATTEMPT)?.lastBody?.settings.shot_type, "single");
    assert.equal(h.states.get(ATTEMPT)?.lastBody?.settings.audio_setting, "auto");
    assert.equal(Object.hasOwn(h.states.get(ATTEMPT)?.lastBody?.settings ?? {}, "n"), false);
    await assert.rejects(client.startOwnerWan27R2vWithOwnedCandidate({ ...operation, chat }));
    assert.equal(h.states.get(ATTEMPT)?.generationPosts, 1);

    h.now.value += 16 * 60_000;
    const history = await client.listOwnedWan27R2vCandidates(chat);
    assert.equal(history.status, "COMPLETE"); assert.equal(history.owner_ack_status, "MATCHED"); assert.equal(history.contexts.length, 1);
    const result = await client.getOwnedWan27R2vResult(history.contexts[0]!);
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.ready_videos[0]?.object_url, RESULT_URL); assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(h.states.get(ATTEMPT)?.historyGets, 1); assert.equal(h.states.get(ATTEMPT)?.resultGets, 1);
  } finally {
    await h.preparer.close(); await h.references.close();
    if (media) { releaseTrustedOwnerWan27R2vVideoCropReceipt(media.crop); releaseTrustedOwnerWan27R2vOriginalProbeResult(media.original); await rm(media.directory, { recursive: true, force: true }); }
  }
});

test("native R2V rejects forged packet/candidate/permit, foreign client, and revoked owner before dispatch", async () => {
  const h = await harness();
  try {
    const manifest = await makeImageManifest(h, ATTEMPT), candidate = await h.preparer.prepare(requestFor(ATTEMPT, manifest.manifest_handle));
    const operation = await operationFor(h, candidate), client = h.clients.get(ATTEMPT)!;
    await assert.rejects(createOwnerWan27R2vOneShotPermit({ preparer: h.preparer, candidate,
      principal: operation.principal, attemptId: ATTEMPT }), errorCode("CANDIDATE_ALREADY_ISSUED"));
    assert.throws(() => consumeOwnerWan27R2vNativeInvocation(operation, Object.freeze(Object.create(null)), "create"),
      (error: unknown) => error instanceof Error && error.message.includes("INVOCATION_INVALID"));
    await assert.rejects(client.createOwnerWan27R2vChat({ ...operation, candidate: { ...candidate } }), errorCode("CANDIDATE_INVALID"));
    await assert.rejects(client.createOwnerWan27R2vChat({ ...operation, permit: { ...operation.permit } }), errorCode("CANDIDATE_INVALID"));
    const foreign = h.clients.get(OTHER)!;
    await assert.rejects(foreign.createOwnerWan27R2vChat(operation));
    assert.equal(h.states.get(ATTEMPT)?.chatCreates, 0); assert.equal(h.states.get(OTHER)?.chatCreates, 0);

    h.states.get(ATTEMPT)!.onCreateChat = () => h.links.revoke(BINDING, ATTEMPT).then(() => undefined);
    await assert.rejects(client.createOwnerWan27R2vChat(operation), (error: unknown) => error instanceof OwnerWan27R2vNativeError &&
      typeof error.code === "string" && ["CANDIDATE_INVALID", "PRINCIPAL_NOT_LINKED", "CHAT_CREATE_FAILED", "REQUEST_ABORTED"].includes(error.code));
    assert.equal(h.states.get(ATTEMPT)?.chatCreates, 1); assert.equal(h.states.get(ATTEMPT)?.generationPosts, 0);
    await assert.rejects(client.createOwnerWan27R2vChat(operation));
    assert.equal(h.states.get(ATTEMPT)?.chatCreates, 1);
  } finally { await h.preparer.close(); await h.references.close(); }
});

test("lost native R2V POST acknowledgement remains unknown and cannot be replayed", async () => {
  const h = await harness();
  try {
    const manifest = await makeImageManifest(h, ATTEMPT), candidate = await h.preparer.prepare(requestFor(ATTEMPT, manifest.manifest_handle));
    const operation = await operationFor(h, candidate), client = h.clients.get(ATTEMPT)!, chat = await client.createOwnerWan27R2vChat(operation);
    h.states.get(ATTEMPT)!.loseNextAck = true;
    const started = { ...operation, chat };
    await assert.rejects(client.startOwnerWan27R2vWithOwnedCandidate(started), errorCode("OUTCOME_UNKNOWN"));
    await assert.rejects(client.startOwnerWan27R2vWithOwnedCandidate(started));
    assert.equal(h.states.get(ATTEMPT)?.generationPosts, 1);
    const history = await client.listOwnedWan27R2vCandidates(chat);
    assert.equal(history.owner_ack_status, "MISSING"); assert.equal(history.contexts.length, 0);
  } finally { await h.preparer.close(); await h.references.close(); }
});

test("valid native R2V ACK is retained for GET recovery if the caller aborts after the POST callback", async () => {
  const h = await harness();
  try {
    const manifest = await makeImageManifest(h, ATTEMPT), candidate = await h.preparer.prepare(requestFor(ATTEMPT, manifest.manifest_handle));
    const operation = await operationFor(h, candidate), client = h.clients.get(ATTEMPT)!, chat = await client.createOwnerWan27R2vChat(operation);
    const controller = new AbortController(), state = h.states.get(ATTEMPT)!;
    state.abortController = controller;
    await assert.rejects(client.startOwnerWan27R2vWithOwnedCandidate({ ...operation, chat }, controller.signal), errorCode("OUTCOME_UNKNOWN"));
    assert.equal(state.generationPosts, 1);
    const history = await client.listOwnedWan27R2vCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED"); assert.equal(history.contexts.length, 1);
  } finally { await h.preparer.close(); await h.references.close(); }
});
