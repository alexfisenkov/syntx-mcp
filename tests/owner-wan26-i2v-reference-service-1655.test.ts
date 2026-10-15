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
  OwnerWan26I2vReferenceService,
  OwnerWan26I2vReferenceServiceError
} from "../src/application/owner-wan26-i2v-reference-service.js";

const exec = promisify(execFile);
const MODEL_IDS = ["wan_26_i2v", "wan_26_i2v_flash"] as const;
const ATTEMPT = "link_wan26_reference_owner_0123456789";
const OTHER_ATTEMPT = "link_wan26_reference_other_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan26-reference-test", subject: "owner" });
const MEDIA = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
let now = 1_000;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64"); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (token: string) => Promise<T>) { return fn("synthetic-wan26-reference-test-token"); } }; }
function json(value: unknown): Response { return Response.json(value); }
function uploaded(file: File, id: number): Response {
  const media_type = file.type.startsWith("image/") ? "image" : "audio";
  return json({ files: [{ id, url: `https://r2.syntx.ai/test/${id}-${file.name}`, filename: file.name,
    mime_type: file.type, content_type: file.type, media_type, type: media_type, size: file.size, status: "uploaded" }] });
}
function createClient(onUpload?: (file: File, model: string, signal?: AbortSignal) => Promise<Response>) {
  let post = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl: async (_url, init) => {
    const form = init?.body as FormData; const file = form.get("files"); assert.ok(file instanceof File);
    assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    const model = form.get("model_type"); assert.equal(typeof model, "string"); post += 1;
    return onUpload ? onUpload(file, model as string, init?.signal ?? undefined) : uploaded(file, post);
  } });
  return { client, posts: () => post };
}
async function linked(ids: readonly string[] = [ATTEMPT]) {
  now = 1_000; let index = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `wan26-${index}`, approval_url: "https://example.invalid" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  return links;
}
function service(links: PerUserLinkService, client: SyntxChatHttpClient, nowFn: () => number = () => now, ffprobePath = MEDIA?.ffprobe ?? "/opt/homebrew/bin/ffprobe") {
  return new OwnerWan26I2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, ffprobePath, now: nowFn });
}
function upload(attemptId: string, model_id: string, filename: string, mime_type: string, bytes: Uint8Array) {
  return { attemptId, model_id, filename, mime_type, content_base64: Buffer.from(bytes).toString("base64") };
}
const knownError = (code: string) => (error: unknown) => error instanceof OwnerWan26I2vReferenceServiceError && error.code === code;

test("real native image upload and image-only captured tuple work for both exact WAN model IDs", async () => {
  const links = await linked(), { client, posts } = createClient(); const refs = service(links, client); const image = png384();
  try {
    for (const model_id of MODEL_IDS) {
      const receipt = await refs.uploadImage(upload(ATTEMPT, model_id, "frame.png", "image/png", image));
      assert.equal(receipt.model_id, model_id); assert.equal(receipt.status, "uploaded"); assert.equal(receipt.generation_permit, false);
      assert.equal("url" in receipt, false); assert.equal(JSON.stringify(receipt).includes("https://"), false);
      const input = { attempt_id: ATTEMPT, model_id, image_handle: receipt.image_handle, audio_handle: null };
      const resolution = await refs.resolveReferences(input);
      assert.equal(refs.isOwnedReferenceResolution(resolution, input), true); assert.equal(resolution.audio, null);
      assert.equal(resolution.image.model_id, model_id); assert.equal(resolution.generation_permit, false);
      assert.deepEqual(await refs.withCapturedNativeReferences(resolution, input,
        (actual, tuple) => [actual === client, tuple.length, readOwnerWan26I2vUploadReferenceForClient(actual, tuple[0])?.url]),
      [true, 1, `https://r2.syntx.ai/test/${posts()}-frame.png`]);
    }
    assert.equal(posts(), 2);
  } finally { await refs.close(); image.fill(0); }
});

test("probes and uploads genuine MP3/WAV references, then resolves image plus audio in exact native order", async (t) => {
  if (!MEDIA) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await exec(MEDIA.ffmpeg, ["-version"]); await exec(MEDIA.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-reference-1655-"));
  const mp3Path = join(directory, "tone.mp3"), wavPath = join(directory, "tone.wav");
  try {
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", mp3Path]);
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le", wavPath]);
    const links = await linked(), { client, posts } = createClient(), refs = service(links, client, () => now, MEDIA.ffprobe), image = png384();
    try {
      for (const [index, model_id] of MODEL_IDS.entries()) {
        const imageReceipt = await refs.uploadImage(upload(ATTEMPT, model_id, `frame-${index}.png`, "image/png", image));
        const imagePostId = posts();
        for (const fixture of [
          { path: mp3Path, filename: "tone.mp3", mime: "audio/mp3" },
          { path: wavPath, filename: "tone.wav", mime: "audio/wav" }
        ] as const) {
          const bytes = await readFile(fixture.path);
          try {
            const audioReceipt = await refs.uploadAudio(upload(ATTEMPT, model_id, fixture.filename, fixture.mime, bytes));
            assert.equal(audioReceipt.model_id, model_id); assert.equal(audioReceipt.generation_permit, false);
            assert.equal("url" in audioReceipt, false); assert.equal(JSON.stringify(audioReceipt).includes("https://"), false);
            const input = { attempt_id: ATTEMPT, model_id, image_handle: imageReceipt.image_handle, audio_handle: audioReceipt.audio_handle };
            const resolution = await refs.resolveReferences(input);
            assert.equal(refs.isOwnedReferenceResolution(resolution, input), true); assert.ok(resolution.audio);
            assert.ok(resolution.audio.duration_seconds >= 3 && resolution.audio.duration_seconds <= 30);
            const actual = await refs.withCapturedNativeReferences(resolution, input, (native, tuple) => [native === client,
              tuple.length, tuple.map((context) => context.media_type), tuple.map((context) => readOwnerWan26I2vUploadReferenceForClient(native, context)?.url)]);
            assert.deepEqual(actual, [true, 2, ["image", "audio"], [
              `https://r2.syntx.ai/test/${imagePostId}-frame-${index}.png`, `https://r2.syntx.ai/test/${posts()}-${fixture.filename}`
            ]]);
          } finally { bytes.fill(0); }
        }
      }
      assert.equal(posts(), 6);
    } finally { await refs.close(); image.fill(0); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("semantic cache reuses only exact owner attempt, model, and bytes; pending duplicate cannot steal claim", async () => {
  const links = await linked(); let acknowledge!: (response: Response) => void; let holdFirst = true;
  const { client, posts } = createClient(async (file) => {
    if (holdFirst) { holdFirst = false; return new Promise<Response>((resolve) => { acknowledge = resolve; }); }
    return uploaded(file, 2);
  }); const refs = service(links, client), image = png384();
  const request = upload(ATTEMPT, "wan_26_i2v", "frame.png", "image/png", image);
  try {
    const first = refs.uploadImage(request);
    for (let i = 0; !acknowledge && i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(typeof acknowledge, "function");
    await assert.rejects(refs.uploadImage(request), knownError("SERVICE_BUSY")); assert.equal(posts(), 1);
    acknowledge(uploaded(new File([new Uint8Array(image)], "frame.png", { type: "image/png" }), 1));
    const firstReceipt = await first, duplicate = await refs.uploadImage(request);
    assert.equal(duplicate.image_handle, firstReceipt.image_handle); assert.equal(posts(), 1);
    const otherModel = await refs.uploadImage(upload(ATTEMPT, "wan_26_i2v_flash", "frame.png", "image/png", image));
    assert.notEqual(otherModel.image_handle, firstReceipt.image_handle); assert.equal(posts(), 2);
  } finally { await refs.close(); image.fill(0); }
});

test("resolution rejects forged, cross-model, cross-attempt and expired handles", async () => {
  const links = await linked([ATTEMPT, OTHER_ATTEMPT]); const { client } = createClient(); let clock = 500;
  const refs = service(links, client, () => clock), image = png384();
  try {
    const receipt = await refs.uploadImage(upload(ATTEMPT, "wan_26_i2v", "frame.png", "image/png", image));
    const input = { attempt_id: ATTEMPT, model_id: "wan_26_i2v", image_handle: receipt.image_handle, audio_handle: null } as const;
    const resolution = await refs.resolveReferences(input);
    assert.equal(refs.isOwnedReferenceResolution(Object.freeze({ ...resolution }), input), false);
    await assert.rejects(refs.resolveReferences({ ...input, attempt_id: OTHER_ATTEMPT }), knownError("REFERENCE_UNAVAILABLE"));
    await assert.rejects(refs.resolveReferences({ ...input, model_id: "wan_26_i2v_flash" }), knownError("REFERENCE_UNAVAILABLE"));
    clock += 15 * 60_000;
    await assert.rejects(refs.resolveReferences(input), knownError("REFERENCE_UNAVAILABLE"));
    assert.equal(refs.isOwnedReferenceResolution(resolution, input), false);
  } finally { await refs.close(); image.fill(0); }
});

test("ambiguous upload is sticky without replay and attempt invalidation drains pending work", async () => {
  const links = await linked(); let release!: (response: Response) => void, calls = 0;
  const { client, posts } = createClient(async () => { calls += 1; if (calls === 1) throw new Error("ambiguous disconnect");
    return new Promise<Response>((resolve) => { release = resolve; }); });
  const refs = service(links, client), image = png384();
  try {
    const ambiguous = upload(ATTEMPT, "wan_26_i2v", "ambiguous.png", "image/png", image);
    await assert.rejects(refs.uploadImage(ambiguous), knownError("UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(refs.uploadImage(ambiguous), knownError("UPLOAD_OUTCOME_UNKNOWN")); assert.equal(posts(), 1);
    const pending = refs.uploadImage(upload(ATTEMPT, "wan_26_i2v_flash", "pending.png", "image/png", image));
    for (let i = 0; !release && i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(typeof release, "function"); const invalidation = refs.invalidateAttempt(ATTEMPT);
    release(uploaded(new File([new Uint8Array(image)], "pending.png", { type: "image/png" }), 2));
    await assert.rejects(pending); await invalidation; assert.equal(posts(), 2);
    await assert.rejects(refs.uploadImage(upload(ATTEMPT, "wan_26_i2v_flash", "pending.png", "image/png", image)),
      (error: unknown) => error instanceof OwnerWan26I2vReferenceServiceError);
  } finally { await refs.close(); image.fill(0); }
});

test("captured async consumer is revalidated after await and invalidation drains without self-deadlock", async () => {
  const links = await linked(), { client } = createClient(), refs = service(links, client), image = png384();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const callbackGate = new Promise<void>((resolve) => { release = resolve; });
  const controller = new AbortController();
  try {
    const receipt = await refs.uploadImage(upload(ATTEMPT, "wan_26_i2v", "frame.png", "image/png", image));
    const input = { attempt_id: ATTEMPT, model_id: "wan_26_i2v", image_handle: receipt.image_handle, audio_handle: null } as const;
    const resolution = await refs.resolveReferences(input);
    const consuming = refs.withCapturedNativeReferences(resolution, input, async (_actual, tuple) => {
      assert.equal(tuple.length, 1); enter(); await callbackGate; return "local-consumer-finished";
    }, controller.signal);
    await entered;
    const invalidation = refs.invalidateAttempt(ATTEMPT);
    controller.abort();
    release();
    await assert.rejects(consuming, (error: unknown) => error instanceof OwnerWan26I2vReferenceServiceError &&
      ["REQUEST_ABORTED", "REFERENCE_EXPIRED"].includes(error.code));
    await invalidation;
    assert.equal(refs.isOwnedReferenceResolution(resolution, input), false);
  } finally { release(); await refs.close(); image.fill(0); }
});
