import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthLinkStore } from "../src/auth/auth-link-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { copyPreparedOwnerElevenLabsStsAudio, prepareOwnerElevenLabsStsWav, releasePreparedOwnerElevenLabsStsAudio } from "../src/application/owner-elevenlabs-sts-wav-preparation.js";
import { createOwnerElevenLabsStsOriginalProbe, releaseTrustedOwnerElevenLabsStsOriginalProbeResult } from "../src/application/owner-elevenlabs-sts-original-probe.js";

const ffmpeg = process.env.SYNTX_ELEVENLABS_STS_TEST_FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.SYNTX_ELEVENLABS_STS_TEST_FFPROBE ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const attempt = "link_sts_current_wav_owner_012345678901", binding = { tenant_id: "sts-wav-synthetic", subject: "owner" };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
test("STS genuine5second and300second WAV full audio preparation preserves MP3 bytes through actual SDK native upload", { timeout: 120000 }, async (t) => {
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Trusted local ffmpeg/ffprobe pair required"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-sts-wav-current-"));
  const make = async (seconds: number) => {
    const path = join(directory, `source${seconds}.wav`); execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=8000:duration=${seconds}`,
      "-c:a", "pcm_s16le", "-y", path]); return await readFile(path);
  };
  const five = await make(5), threeHundred = await make(300), inputHash5 = hash(five), inputHash300 = hash(threeHundred);
  const mp3Path = join(directory, "original.mp3"); execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=6", "-c:a", "libmp3lame", "-y", mp3Path]);
  const mp3 = await readFile(mp3Path), mp3Hash = hash(mp3); let uploads = 0, expectOriginal = false;
  const authStore = {
    async getSnapshot() { return { attempt_id: attempt, authorization_profile: OBSERVED_AUTHORIZATION_PROFILE, status: "LINKED" as const, expires_at: null, linked: true }; },
    async useCredential<T>(_binding: unknown, _attempt: unknown, use: (value: { scheme: "Bearer"; value: string }) => T | Promise<T>) { return await use({ scheme: "Bearer", value: "synthetic-sts-wav-only" }); }
  } as unknown as AuthLinkStore;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files"); assert.equal(init?.method, "POST"); uploads++;
    const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.type, "audio/mpeg"); assert.match(file.name, /\.mp3$/u);
    const bytes = Buffer.from(await file.arrayBuffer()); try { if (expectOriginal) assert.deepEqual(bytes, mp3); else assert.notEqual(bytes.toString("ascii", 0, 4), "RIFF"); }
    finally { bytes.fill(0); }
    return Response.json({ files: [{ filename: file.name, size: file.size, content_type: "audio/mpeg", status: "success", url: `https://r2.syntx.ai/sts-wav-current/input${uploads}.mp3` }] });
  };
  const runtime = createObservedOwnerRuntime({ ownerElevenLabsStsEnabled: true, ownerElevenLabsStsFfprobePath: ffprobe,
    ownerElevenLabsStsFfmpegPath: ffmpeg, ownerElevenLabsStsUploadDestination: "hidden", authBinding: binding, authStore, fetchImpl });
  const server = createMcpServer(runtime.application, runtime.serverOptions), client = new Client({ name: "sts-wav", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  await server.connect(host); await client.connect(caller);
  const upload = async (filename: string, mime_type: string, bytes: Buffer) => await client.callTool({ name: "syntx_owner_upload_elevenlabs_sts_original", arguments: {
    link_attempt_id: attempt, filename, mime_type, content_base64: bytes.toString("base64") } });
  try {
    const tools = await client.listTools(), descriptor = tools.tools.find(tool => tool.name === "syntx_owner_upload_elevenlabs_sts_original")!;
    assert.match(JSON.stringify(descriptor.inputSchema), /audio\/wav/u);
    for (const [seconds, bytes] of [[5, five], [300, threeHundred]] as const) {
      const result = await upload(`source${seconds}.wav`, "audio/wav", bytes); assert.notEqual(result.isError, true, JSON.stringify(result));
      const receipt = result.structuredContent as any; assert.equal(receipt.mime_type, "audio/mpeg"); assert.equal(receipt.duration_seconds, seconds);
      assert.equal(receipt.preparation.uploaded_duration_seconds, seconds); assert.equal(receipt.preparation.original_duration_seconds, seconds);
      assert.equal(receipt.preparation.original_sha256, hash(bytes)); assert.equal(receipt.preparation.direct_wav_upload, false); assert.equal(JSON.stringify(result).includes("https://r2.syntx.ai"), false);
    }
    expectOriginal = true;
    for (const mime of ["audio/mpeg", "audio/mp3"]) { const original = await upload("original.mp3", mime, mp3); assert.notEqual(original.isError, true, JSON.stringify(original)); assert.equal((original.structuredContent as any).sha256, mp3Hash); assert.equal((original.structuredContent as any).preparation, undefined); }
    assert.equal(hash(five), inputHash5); assert.equal(hash(threeHundred), inputHash300); assert.equal(hash(mp3), mp3Hash); assert.equal(uploads, 4);
    const invalid = await upload("fake.wav", "audio/wav", mp3); assert.equal(invalid.isError, true); assert.equal(uploads, 4);
    const parameters = await client.callTool({ name: "syntx_get_elevenlabs_sts_parameters", arguments: {} }); assert.notEqual(parameters.isError, true, JSON.stringify(parameters));
    assert.match(JSON.stringify(parameters.structuredContent), /STREAM_DECODE_SAMPLE_DURATION/u);
  } finally { await client.close(); await server.close(); await runtime.ownerElevenLabsStsLifecycle?.close(); five.fill(0); threeHundred.fill(0); mp3.fill(0); await rm(directory, { recursive: true, force: true }); }
});

test("STS prepared witness rejects forged lineage before probe authority", { timeout: 30000 }, async (t) => {
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) { t.skip("Trusted local ffmpeg/ffprobe pair required"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-sts-wav-witness-")), path = join(directory, "source.wav");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=5", "-c:a", "pcm_s16le", "-y", path]);
  const wav = await readFile(path), prepared = await prepareOwnerElevenLabsStsWav({ filename: "source.wav", bytes: wav }, { ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const bytes = copyPreparedOwnerElevenLabsStsAudio(prepared), probe = createOwnerElevenLabsStsOriginalProbe({ ffprobePath: ffprobe });
  try {
    await assert.rejects(probe.probe({ filename: prepared.filename, mime_type: "audio/mpeg", bytes, prepared_audio: { ...prepared } }));
    const actual = await probe.probe({ filename: prepared.filename, mime_type: "audio/mpeg", bytes, prepared_audio: prepared });
    assert.equal(actual.metadata.duration_seconds, 5); releaseTrustedOwnerElevenLabsStsOriginalProbeResult(actual);
    await assert.rejects(prepareOwnerElevenLabsStsWav({ filename: "source.wav", bytes: wav }, { ffmpegPath: "relative-ffmpeg", ffprobePath: ffprobe }));
    await assert.rejects(prepareOwnerElevenLabsStsWav({ filename: " source.wav", bytes: wav }, { ffmpegPath: ffmpeg, ffprobePath: ffprobe }));
  } finally { bytes.fill(0); wav.fill(0); releasePreparedOwnerElevenLabsStsAudio(prepared); await rm(directory, { recursive: true, force: true }); }
});
