import assert from "node:assert/strict";
import test from "node:test";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyTrustedOwnerWan26I2vAudioBytes, createOwnerWan26I2vAudioProbe, isTrustedOwnerWan26I2vAudioProbeResult,
  OwnerWan26I2vAudioProbeError, releaseTrustedOwnerWan26I2vAudioProbeResult,
  type OwnerWan26I2vAudioModelId, type OwnerWan26I2vAudioMime
} from "../src/application/owner-wan26-i2v-audio-probe.js";

const run = promisify(execFileCallback);
const FFMPEG = process.env.SYNTX_WAN26_AUDIO_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_WAN26_AUDIO_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const AVAILABLE = existsSync(FFMPEG) && existsSync(FFPROBE);
const MODELS: OwnerWan26I2vAudioModelId[] = ["wan_26_i2v", "wan_26_i2v_flash"];

async function generate(directory: string, name: string, duration: number, format: "mp3" | "wav"): Promise<Uint8Array> {
  const output = join(directory, name);
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=" + duration];
  if (format === "mp3") args.push("-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", output);
  else args.push("-c:a", "pcm_s16le", "-f", "wav", output);
  await run(FFMPEG, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 });
  return new Uint8Array(await readFile(output));
}
function makeInput(bytes: Uint8Array, filename: string, mime_type: OwnerWan26I2vAudioMime, model_id: OwnerWan26I2vAudioModelId = "wan_26_i2v") {
  return { model_id, filename, mime_type, bytes };
}
async function withDir<T>(fn: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-audio-1651-"));
  try { return await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("actual MP3 and WAV probe for both WAN 2.6 models canonicalizes aliases and seals local evidence", async (t) => {
  if (!AVAILABLE) { t.skip("configured ffmpeg/ffprobe pair is unavailable"); return; }
  await withDir(async (directory) => {
    const mp3 = await generate(directory, "sample.mp3", 4, "mp3"), wav = await generate(directory, "sample.wav", 4, "wav");
    const cases: Array<{ bytes: Uint8Array; filename: string; mime: OwnerWan26I2vAudioMime; canonical: string; container: string }> = [
      { bytes: mp3, filename: "sample.mp3", mime: "audio/mp3", canonical: "audio/mpeg", container: "MP3" },
      { bytes: mp3, filename: "sample.mp3", mime: "audio/mpeg", canonical: "audio/mpeg", container: "MP3" },
      { bytes: wav, filename: "sample.wav", mime: "audio/wav", canonical: "audio/wav", container: "WAV" },
      { bytes: wav, filename: "sample.wav", mime: "audio/x-wav", canonical: "audio/wav", container: "WAV" }
    ];
    for (const model_id of MODELS) for (const item of cases) {
      const result = await createOwnerWan26I2vAudioProbe({ ffprobePath: FFPROBE }).probe(makeInput(item.bytes, item.filename, item.mime, model_id));
      try {
        assert.equal(isTrustedOwnerWan26I2vAudioProbeResult(result), true);
        assert.equal(result.status, "TRUSTED_LOCAL_AUDIO_PROBE");
        assert.equal(result.model_id, model_id);
        assert.equal(result.source_mime_type, item.mime);
        assert.equal(result.mime_type, item.canonical);
        assert.equal(result.bytes_copied, item.bytes.byteLength);
        assert.match(result.source_sha256, /^[a-f0-9]{64}$/);
        assert.equal(result.metadata.container, item.container);
        assert.ok(result.metadata.sample_rate > 0 && result.metadata.channels > 0 && result.metadata.decoded_frame_count > 0);
        assert.ok(result.metadata.duration_seconds >= 3 && result.metadata.duration_seconds <= 30);
        assert.equal(result.dispatch_allowed, false);
        assert.equal(result.runtime_usable, false);
        assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
      } finally { releaseTrustedOwnerWan26I2vAudioProbeResult(result); }
    }
  });
});

test("measured duration and byte limits apply locally, and caller metadata cannot mismatch container", async (t) => {
  if (!AVAILABLE) { t.skip("configured ffmpeg/ffprobe pair is unavailable"); return; }
  await withDir(async (directory) => {
    const short = await generate(directory, "short.mp3", 2.5, "mp3"), long = await generate(directory, "long.wav", 30.2, "wav");
    const probe = createOwnerWan26I2vAudioProbe({ ffprobePath: FFPROBE });
    await assert.rejects(probe.probe(makeInput(short, "short.mp3", "audio/mpeg")), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    await assert.rejects(probe.probe(makeInput(long, "long.wav", "audio/wav")), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    await assert.rejects(probe.probe(makeInput(new Uint8Array(10_485_761), "large.mp3", "audio/mpeg")), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    await assert.rejects(probe.probe(makeInput(new Uint8Array(32), "wrong.wav", "audio/mpeg")), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
    await assert.rejects(probe.probe(makeInput(new Uint8Array(32), "wrong.mp3", "audio/x-wav")), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  });
});

test("probe rejects additional audio streams instead of selecting only the first", async (t) => {
  if (!AVAILABLE) { t.skip("configured ffmpeg/ffprobe pair is unavailable"); return; }
  await withDir(async (directory) => {
    const binary = join(directory, "ffprobe-multiple-streams");
    const output = JSON.stringify({ streams: [
      { codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 1, nb_read_frames: "100", duration: "4" },
      { codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 1, nb_read_frames: "100", duration: "4" }
    ], format: { format_name: "mp3", duration: "4" } });
    await writeFile(binary, "#!/bin/sh\nprintf '%s' '" + output + "'\n", { mode: 0o700, flag: "wx" });
    await chmod(binary, 0o700);
    await assert.rejects(createOwnerWan26I2vAudioProbe({ ffprobePath: binary }).probe(makeInput(new Uint8Array(32), "multi.mp3", "audio/mpeg")),
      (error: unknown) => error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  });
});

test("sealed snapshots copy bytes defensively, reject forged or proxied evidence, and release revokes trust", async (t) => {
  if (!AVAILABLE) { t.skip("configured ffmpeg/ffprobe pair is unavailable"); return; }
  await withDir(async (directory) => {
    const bytes = await generate(directory, "sealed.wav", 4, "wav");
    const result = await createOwnerWan26I2vAudioProbe({ ffprobePath: FFPROBE }).probe(makeInput(bytes, "sealed.wav", "audio/wav"));
    const copy = copyTrustedOwnerWan26I2vAudioBytes(result);
    copy[0] = (copy[0] ?? 0) ^ 255;
    assert.deepEqual(copyTrustedOwnerWan26I2vAudioBytes(result), bytes);
    assert.equal(isTrustedOwnerWan26I2vAudioProbeResult(new Proxy(result, {})), false);
    assert.equal(isTrustedOwnerWan26I2vAudioProbeResult({ ...result }), false);
    releaseTrustedOwnerWan26I2vAudioProbeResult(result);
    assert.equal(isTrustedOwnerWan26I2vAudioProbeResult(result), false);
    assert.throws(() => copyTrustedOwnerWan26I2vAudioBytes(result), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  });
});

test("WAV probe rejects inherited MIME keys and hostile typed-array accessors without invoking them", async (t) => {
  if (!AVAILABLE) { t.skip("configured ffmpeg/ffprobe pair is unavailable"); return; }
  await withDir(async (directory) => {
    const bytes = await generate(directory, "hostile.wav", 4, "wav");
    const probe = createOwnerWan26I2vAudioProbe({ ffprobePath: FFPROBE });
    const valid = await probe.probe(makeInput(bytes, "hostile.wav", "audio/wav"));
    releaseTrustedOwnerWan26I2vAudioProbeResult(valid);
    for (const mime_type of ["constructor", "__proto__"] as unknown as OwnerWan26I2vAudioMime[]) {
      await assert.rejects(probe.probe(makeInput(bytes, "hostile.wav", mime_type)), (error: unknown) =>
        error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
    }
    let getterCalls = 0;
    const ownConstructor = new Uint8Array(bytes);
    Object.defineProperty(ownConstructor, "constructor", { get() { getterCalls += 1; return Uint8Array; } });
    const ownByteLength = new Uint8Array(bytes);
    Object.defineProperty(ownByteLength, "byteLength", { get() { getterCalls += 1; return bytes.byteLength; } });
    const ownSpecies = new Uint8Array(bytes);
    Object.defineProperty(ownSpecies, Symbol.species, { get() { getterCalls += 1; return Uint8Array; } });
    for (const hostile of [ownConstructor, ownByteLength, ownSpecies]) {
      await assert.rejects(probe.probe(makeInput(hostile, "hostile.wav", "audio/wav")), (error: unknown) =>
        error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
    }
    class AudioBytesSubclass extends Uint8Array {}
    await assert.rejects(probe.probe(makeInput(new AudioBytesSubclass(bytes), "hostile.wav", "audio/wav")), (error: unknown) =>
      error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
    assert.equal(getterCalls, 0);
  });
});

test("strict input/config and abort handling reject accessors/proxies and drain child before cleanup", async () => {
  assert.throws(() => createOwnerWan26I2vAudioProbe({ ffprobePath: "ffprobe" }), (error: unknown) =>
    error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  assert.throws(() => createOwnerWan26I2vAudioProbe(new Proxy({ ffprobePath: FFPROBE }, {})), (error: unknown) =>
    error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  const probe = createOwnerWan26I2vAudioProbe({ ffprobePath: FFPROBE });
  const accessorInput = Object.defineProperty({ model_id: "wan_26_i2v", filename: "x.mp3", mime_type: "audio/mpeg", bytes: new Uint8Array(32) }, "bytes", { get: () => new Uint8Array(32), enumerable: true });
  await assert.rejects(probe.probe(accessorInput), (error: unknown) => error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  await assert.rejects(probe.probe(new Proxy({ model_id: "wan_26_i2v", filename: "x.mp3", mime_type: "audio/mpeg", bytes: new Uint8Array(32) }, {})),
    (error: unknown) => error instanceof OwnerWan26I2vAudioProbeError && error.code === "INVALID_ORIGINAL");
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-audio-abort-1651-"));
  try {
    const started = join(directory, "started"), marker = join(directory, "input-at-close"), binary = join(directory, "ffprobe-fixture");
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const childCode = "const fs=require(\"node:fs\");const input=process.argv.at(-1);fs.writeFileSync(" + JSON.stringify(started) +
      ",\"started\");process.on(\"SIGTERM\",()=>setTimeout(()=>{fs.writeFileSync(" + JSON.stringify(marker) +
      ",fs.existsSync(input)?\"present\":\"absent\");process.exit(0)},200));setInterval(()=>{},10000)";
    await writeFile(binary, "#!/bin/sh\nexec " + quote(process.execPath) + " -e " + quote(childCode) + " -- \"$@\"\n", { mode: 0o700, flag: "wx" });
    await chmod(binary, 0o700);
    const controller = new AbortController();
    const pending = createOwnerWan26I2vAudioProbe({ ffprobePath: binary }).probe(
      { model_id: "wan_26_i2v", filename: "x.mp3", mime_type: "audio/mpeg", bytes: new Uint8Array(32) }, { signal: controller.signal });
    let childStarted = false;
    for (let attempt = 0; attempt < 50 && !childStarted; attempt += 1) {
      try { childStarted = (await readFile(started, "utf8")) === "started"; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(childStarted, true);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof OwnerWan26I2vAudioProbeError && error.code === "PROBE_ABORTED");
    assert.equal(await readFile(marker, "utf8"), "present");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
