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
import { readOwnerWan26I2vUploadReferenceForClient } from "../src/adapter/syntx/wan26-i2v-upload-context.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  OwnerWan26I2vReferenceService
} from "../src/application/owner-wan26-i2v-reference-service.js";
import {
  createOwnerWan26I2vRequestPreparer,
  isOwnerWan26I2vPreparedCandidate,
  readOwnerWan26I2vNativeBindingForClient,
  OwnerWan26I2vRequestPreparerError,
  type OwnerWan26I2vPreparedCandidate,
  type OwnerWan26I2vRequestPreparer
} from "../src/application/owner-wan26-i2v-request-preparer.js";
import {
  createOwnerWan26I2vOneShotPermit,
  consumeOwnerWan26I2vOneShotPermit,
  revalidateOwnerWan26I2vOneShotPermit,
  OwnerWan26I2vOneShotPolicyError,
  type OwnerWan26I2vOneShotPermitContext
} from "../src/application/owner-wan26-i2v-one-shot-policy.js";

const exec = promisify(execFile);
const MODEL_IDS = ["wan_26_i2v", "wan_26_i2v_flash"] as const;
const ATTEMPT = "link_wan26_preparer_owner_0123456789";
const OTHER_ATTEMPT = "link_wan26_preparer_other_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan26-preparer-test", subject: "owner" });
const MEDIA = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const INVALID_CANDIDATE = (code: string) => (error: unknown) => error instanceof OwnerWan26I2vRequestPreparerError && error.code === code;
const INVALID_PERMIT = (code: string) => (error: unknown) => error instanceof OwnerWan26I2vOneShotPolicyError && error.code === code;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64"); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function params(model_id: typeof MODEL_IDS[number]) {
  return { resolution: "1080P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0,
    native_audio: model_id === "wan_26_i2v_flash" } as const;
}
function json(value: unknown): Response { return Response.json(value); }
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("wan26-preparer-test-token"); } };
}

async function setup(options: { readonly attemptIds?: readonly string[]; readonly holdClient?: () => boolean; readonly useDefaultClock?: boolean } = {}) {
  let now = 1_000, id = 0, clientLookupStarted!: () => void, clientLookupGate: Promise<void> | undefined;
  const clientLookup = new Promise<void>((resolve) => { clientLookupStarted = resolve; });
  let releaseClientLookup!: () => void;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `wan26-preparer-${id}`, approval_url: "https://example.invalid" }; },
    async pollChallenge(_challenge, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => (options.attemptIds ?? [ATTEMPT])[id++]!
  });
  for (const attemptId of options.attemptIds ?? [ATTEMPT]) {
    await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId);
  }
  const posts: Array<{ readonly filename: string; readonly mime: string; readonly model: string; readonly url: string }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl: async (_url, init) => {
    const form = init?.body; assert.ok(form instanceof FormData); const file = form.get("files"); assert.ok(file instanceof File);
    assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    const model = form.get("model_type"); assert.ok(typeof model === "string");
    const postId = posts.length + 1, media_type = file.type.startsWith("image/") ? "image" : "audio";
    const url = `https://r2.syntx.ai/wan26-preparer/${postId}-${file.name}`;
    posts.push(Object.freeze({ filename: file.name, mime: file.type, model, url }));
    return json({ files: [{ id: postId, url, filename: file.name, mime_type: file.type, content_type: file.type,
      media_type, type: media_type, size: file.size, status: "uploaded" }] });
  } });
  const referenceService = new OwnerWan26I2vReferenceService({ binding: BINDING, linkService: links,
    resolveClient: async () => {
      if (options.holdClient?.()) { clientLookupStarted(); await (clientLookupGate ??= new Promise<void>((resolve) => { releaseClientLookup = resolve; })); }
      return client;
    }, ffprobePath: MEDIA?.ffprobe ?? "/opt/homebrew/bin/ffprobe", ...(options.useDefaultClock ? {} : { now: () => now }) });
  const preparer = createOwnerWan26I2vRequestPreparer({ referenceService, ...(options.useDefaultClock ? {} : { now: () => now }) });
  return { client, links, posts, referenceService, preparer, get now() { return now; }, set now(value: number) { now = value; }, clientLookup, releaseClientLookup: () => releaseClientLookup?.() };
}

function imageInput(attemptId: string, model_id: typeof MODEL_IDS[number], bytes: Uint8Array, filename: string) {
  return { attemptId, model_id, filename, mime_type: "image/png", content_base64: Buffer.from(bytes).toString("base64") };
}
async function uploadImage(state: Awaited<ReturnType<typeof setup>>, model_id: typeof MODEL_IDS[number], bytes: Uint8Array, filename = "frame.png", attemptId = ATTEMPT) {
  return state.referenceService.uploadImage(imageInput(attemptId, model_id, bytes, filename));
}
async function prepare(state: Awaited<ReturnType<typeof setup>>, model_id: typeof MODEL_IDS[number], image_handle: string,
  audio_handle: string | null = null, prompt = "A quiet cinematic scene.", attempt_id = ATTEMPT) {
  return state.preparer.prepare({ attempt_id, model_id, image_handle, audio_handle, prompt, parameters: params(model_id) });
}
function permitInput(preparer: OwnerWan26I2vRequestPreparer, candidate: OwnerWan26I2vPreparedCandidate) {
  const binding = preparer.inspectCandidate(candidate); assert.ok(binding);
  return Object.freeze({ preparer, candidate, principal: binding.principal, attemptId: binding.attempt_id });
}

test("prepares image-only wire and native token for both exact models without publishing private data", async () => {
  const state = await setup(), bytes = png384();
  try {
    for (const model_id of MODEL_IDS) {
      const receipt = await uploadImage(state, model_id, bytes, `${model_id}.png`);
      const candidate = await prepare(state, model_id, receipt.image_handle);
      const request = state.preparer.getPrivateRequest(candidate);
      assert.equal(candidate.model_id, model_id); assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN"); assert.equal(candidate.runtime_usable, false);
      assert.equal(candidate.image_reference_count, 1); assert.equal(candidate.audio_reference_count, 0);
      assert.equal("prompt" in candidate, false); assert.equal(JSON.stringify(candidate).includes(ATTEMPT), false);
      assert.equal(JSON.stringify(candidate).includes(receipt.image_handle), false);
      assert.equal(JSON.stringify(candidate).includes("https://"), false);
      assert.equal(request.settings.model_type, model_id); assert.equal(request.settings.video_duration, 5);
      assert.equal("duration" in request.settings, false); assert.equal(request.settings.native_audio, model_id === "wan_26_i2v_flash");
      assert.deepEqual(request.settings.file_urls.map(({ type }) => type), ["image"]);
      assert.ok(request.prompt.includes("A quiet cinematic scene."));
      const token = state.preparer.getNativeBindingForClient(state.client, candidate);
      const references = readOwnerWan26I2vNativeBindingForClient(state.client, token);
      assert.ok(references); assert.equal(references.length, 1); assert.equal(references[0].media_type, "image");
      assert.deepEqual(readOwnerWan26I2vUploadReferenceForClient(state.client, references[0]), { url: state.posts.at(-1)!.url });
      assert.equal(readOwnerWan26I2vNativeBindingForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), token), null);
    }
  } finally { await state.preparer.close(); await state.referenceService.close(); bytes.fill(0); }
});

test("default monotonic clocks support prepare, permit revalidation, and synchronous consumption", async () => {
  const state = await setup({ useDefaultClock: true }), bytes = png384();
  try {
    const receipt = await uploadImage(state, "wan_26_i2v", bytes);
    const candidate = await prepare(state, "wan_26_i2v", receipt.image_handle);
    assert.ok(Number.isFinite(candidate.expires_at)); assert.ok(candidate.expires_at > performance.now());
    const input = permitInput(state.preparer, candidate);
    const permit = await createOwnerWan26I2vOneShotPermit(input);
    const context: OwnerWan26I2vOneShotPermitContext = Object.freeze({ ...input, permit });
    await revalidateOwnerWan26I2vOneShotPermit(context);
    assert.equal(consumeOwnerWan26I2vOneShotPermit(context).request_fingerprint, candidate.request_fingerprint);
  } finally { await state.preparer.close(); await state.referenceService.close(); bytes.fill(0); }
});

test("joins genuine optional MP3/WAV contexts into image-first exact wire for both models", async (t) => {
  if (!MEDIA) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await exec(MEDIA.ffmpeg, ["-version"]); await exec(MEDIA.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-preparer-1657-"));
  const mp3Path = join(directory, "tone.mp3"), wavPath = join(directory, "tone.wav");
  try {
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", mp3Path]);
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le", wavPath]);
    const state = await setup(), imageBytes = png384();
    try {
      for (const [index, model_id] of MODEL_IDS.entries()) {
        const audioPath = index === 0 ? mp3Path : wavPath, filename = index === 0 ? "tone.mp3" : "tone.wav";
        const mime = index === 0 ? "audio/mp3" : "audio/wav", bytes = await readFile(audioPath);
        try {
          const imageReceipt = await uploadImage(state, model_id, imageBytes, `frame-${index}.png`);
          const audioReceipt = await state.referenceService.uploadAudio({ attemptId: ATTEMPT, model_id, filename, mime_type: mime,
            content_base64: bytes.toString("base64") });
          const candidate = await prepare(state, model_id, imageReceipt.image_handle, audioReceipt.audio_handle);
          const request = state.preparer.getPrivateRequest(candidate), refs = candidate.input_references;
          assert.equal(candidate.audio_reference_count, 1); assert.equal(refs.length, 2);
          assert.deepEqual(refs.map(({ media_type }) => media_type), ["image", "audio"]);
          assert.equal(refs[1]!.mime_type, audioReceipt.mime_type); assert.equal(refs[1]!.sha256, audioReceipt.sha256);
          assert.equal(request.settings.model_type, model_id); assert.equal(request.settings.video_duration, 5);
          assert.equal("duration" in request.settings, false); assert.equal(request.settings.shot_type, "single");
          assert.equal(request.settings.audio_setting, "auto");
          assert.equal(request.settings.native_audio, model_id === "wan_26_i2v_flash");
          assert.deepEqual(request.settings.file_urls.map(({ type }) => type), ["image", "audio"]);
          const token = state.preparer.getNativeBindingForClient(state.client, candidate);
          const native = readOwnerWan26I2vNativeBindingForClient(state.client, token);
          assert.ok(native); assert.equal(native.length, 2);
          assert.deepEqual(native.map((context) => context.media_type), ["image", "audio"]);
          assert.ok(request.settings.file_urls.every(({ url }) => state.posts.some((post) => post.url === url)));
          assert.equal(JSON.stringify(candidate).includes("https://"), false);
        } finally { bytes.fill(0); }
      }
    } finally { await state.preparer.close(); await state.referenceService.close(); imageBytes.fill(0); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("intent fingerprint preserves literal prompt URLs but ignores upload URL rebasing", async () => {
  const state = await setup(), bytes = png384();
  try {
    const firstReceipt = await uploadImage(state, "wan_26_i2v", bytes, "frame-a.png");
    const secondReceipt = await uploadImage(state, "wan_26_i2v", bytes, "frame-b.png");
    const first = await prepare(state, "wan_26_i2v", firstReceipt.image_handle);
    const second = await prepare(state, "wan_26_i2v", secondReceipt.image_handle);
    const firstRequest = state.preparer.getPrivateRequest(first), secondRequest = state.preparer.getPrivateRequest(second);
    const firstUrl = firstRequest.settings.file_urls[0]!.url, secondUrl = secondRequest.settings.file_urls[0]!.url;
    assert.notEqual(firstUrl, secondUrl);
    const literalFirst = await prepare(state, "wan_26_i2v", firstReceipt.image_handle, null, `Refer to <<<${firstUrl}>>>.`);
    const literalSecond = await prepare(state, "wan_26_i2v", secondReceipt.image_handle, null, `Refer to <<<${secondUrl}>>>.`);
    assert.notEqual(literalFirst.intent_fingerprint, literalSecond.intent_fingerprint);
    assert.notEqual(literalFirst.request_fingerprint, literalSecond.request_fingerprint);
    assert.equal(state.preparer.getPrivateRequest(literalFirst).prompt, `Refer to <<<${firstUrl}>>>.`);
    assert.equal(state.preparer.getPrivateRequest(literalSecond).prompt, `Refer to <<<${secondUrl}>>>.`);
    const unknown = await prepare(state, "wan_26_i2v", firstReceipt.image_handle, null, "Refer to <<<https://r2.syntx.ai/not-owned.png>>>.");
    assert.notEqual(unknown.intent_fingerprint, first.intent_fingerprint);
    assert.ok(state.preparer.getPrivateRequest(unknown).prompt.includes("https://r2.syntx.ai/not-owned.png"));
    assert.equal(state.posts.length, 2);
  } finally { await state.preparer.close(); await state.referenceService.close(); bytes.fill(0); }
});

test("one-shot permit claims semantic identity across concurrent URL rebasing and burns before returning wire", async () => {
  const state = await setup(), bytes = png384();
  try {
    const firstReceipt = await uploadImage(state, "wan_26_i2v", bytes, "one.png");
    const secondReceipt = await uploadImage(state, "wan_26_i2v", bytes, "two.png");
    const first = await prepare(state, "wan_26_i2v", firstReceipt.image_handle);
    const second = await prepare(state, "wan_26_i2v", secondReceipt.image_handle);
    assert.equal(first.intent_fingerprint, second.intent_fingerprint); assert.notEqual(first.request_fingerprint, second.request_fingerprint);
    const result = await Promise.allSettled([
      createOwnerWan26I2vOneShotPermit(permitInput(state.preparer, first)),
      createOwnerWan26I2vOneShotPermit(permitInput(state.preparer, second))
    ]);
    assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(result.filter((entry) => entry.status === "rejected").length, 1);
    const permitIndex = result.findIndex((entry) => entry.status === "fulfilled");
    const candidate = permitIndex === 0 ? first : second;
    const input = permitInput(state.preparer, candidate);
    const permit = (result[permitIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof createOwnerWan26I2vOneShotPermit>>>).value;
    const context: OwnerWan26I2vOneShotPermitContext = Object.freeze({ ...input, permit });
    assert.equal(permit.dispatch_allowed, false); assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.throws(() => consumeOwnerWan26I2vOneShotPermit(context), INVALID_PERMIT("PERMIT_NOT_REVALIDATED"));
    await revalidateOwnerWan26I2vOneShotPermit(context);
    const receipt = consumeOwnerWan26I2vOneShotPermit(context);
    assert.equal(receipt.status, "consumed"); assert.equal(receipt.dispatch_allowed, false);
    assert.equal(receipt.request_fingerprint, candidate.request_fingerprint);
    assert.deepEqual(receipt.request, state.preparer.getPrivateRequest(candidate));
    assert.throws(() => consumeOwnerWan26I2vOneShotPermit(context), INVALID_PERMIT("PERMIT_ALREADY_CONSUMED"));
    await assert.rejects(createOwnerWan26I2vOneShotPermit(input), INVALID_PERMIT("CANDIDATE_ALREADY_ISSUED"));
    await assert.rejects(createOwnerWan26I2vOneShotPermit(permitInput(state.preparer, permitIndex === 0 ? second : first)),
      INVALID_PERMIT("CANDIDATE_ALREADY_ISSUED"));
  } finally { await state.preparer.close(); await state.referenceService.close(); bytes.fill(0); }
});

test("rejects forged/cross-model/principal candidates and revokes native tokens on method change or attempt invalidation", async () => {
  const state = await setup({ attemptIds: [ATTEMPT, OTHER_ATTEMPT] }), bytes = png384();
  try {
    const receipt = await uploadImage(state, "wan_26_i2v", bytes);
    const candidate = await prepare(state, "wan_26_i2v", receipt.image_handle);
    const token = state.preparer.getNativeBindingForClient(state.client, candidate);
    assert.equal(state.preparer.getNativeBindingForClient(state.client, candidate), token);
    assert.equal(isOwnerWan26I2vPreparedCandidate({ ...candidate }), false);
    await assert.rejects(state.preparer.revalidateCandidate({ ...candidate }), INVALID_CANDIDATE("CANDIDATE_UNBOUND"));
    assert.equal(readOwnerWan26I2vNativeBindingForClient(state.client, { ...token }), null);
    await assert.rejects(prepare(state, "wan_26_i2v_flash", receipt.image_handle), INVALID_CANDIDATE("REFERENCE_UNAVAILABLE"));
    const binding = state.preparer.inspectCandidate(candidate); assert.ok(binding);
    await assert.rejects(createOwnerWan26I2vOneShotPermit({ preparer: state.preparer, candidate,
      principal: { ...binding.principal, subject_id: "different-owner" }, attemptId: ATTEMPT }), INVALID_PERMIT("PRINCIPAL_MISMATCH"));
    Object.defineProperty(state.client, "uploadWan26I2vAudio", { configurable: true, value: () => Promise.reject(new Error("override")) });
    assert.equal(readOwnerWan26I2vNativeBindingForClient(state.client, token), null);
    delete (state.client as unknown as { uploadWan26I2vAudio?: unknown }).uploadWan26I2vAudio;
    assert.ok(readOwnerWan26I2vNativeBindingForClient(state.client, token));
    await state.preparer.invalidateAttempt(ATTEMPT);
    assert.equal(state.preparer.inspectCandidate(candidate), undefined);
    assert.equal(readOwnerWan26I2vNativeBindingForClient(state.client, token), null);
  } finally { await state.preparer.close(); await state.referenceService.close(); bytes.fill(0); }
});

test("expires candidates and drains a pending resolve when the attempt is invalidated", async () => {
  const state = await setup(), bytes = png384();
  try {
    const receipt = await uploadImage(state, "wan_26_i2v", bytes);
    const candidate = await prepare(state, "wan_26_i2v", receipt.image_handle);
    const expiresAt = candidate.expires_at; state.now = expiresAt;
    assert.equal(state.preparer.inspectCandidate(candidate), undefined);
    assert.throws(() => state.preparer.getPrivateRequest(candidate), INVALID_CANDIDATE("CANDIDATE_EXPIRED"));
  } finally { await state.preparer.close(); await state.referenceService.close(); }

  let hold = false;
  const pendingState = await setup({ holdClient: () => hold });
  try {
    const secondReceipt = await uploadImage(pendingState, "wan_26_i2v_flash", bytes, "pending.png");
    hold = true;
    const pending = pendingState.preparer.prepare({ attempt_id: ATTEMPT, model_id: "wan_26_i2v_flash",
      image_handle: secondReceipt.image_handle, audio_handle: null, prompt: "Wait on the real reference boundary.",
      parameters: params("wan_26_i2v_flash") });
    await pendingState.clientLookup;
    const invalidation = pendingState.preparer.invalidateAttempt(ATTEMPT);
    pendingState.releaseClientLookup(); hold = false;
    await assert.rejects(pending, INVALID_CANDIDATE("REQUEST_ABORTED"));
    await invalidation;
  } finally { await pendingState.preparer.close(); await pendingState.referenceService.close(); bytes.fill(0); }
});
