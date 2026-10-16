import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  isOwnerFlux3V2vOriginalProbe,
  OwnerFlux3V2vOriginalProbeError,
  probeOwnerFlux3V2vOriginal,
  readOwnerFlux3V2vOriginalProbeBytes,
  releaseOwnerFlux3V2vOriginalProbe
} from "../src/application/owner-flux3-v2v-original-probe.js";

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

type Stream = Record<string, unknown>;
function ffprobeOutput(streams: Stream[], formatDuration = "240.8"): string {
  return JSON.stringify({ streams, format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: formatDuration } });
}

async function executableProbe(output: string | null, marker: string): Promise<{ binary: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-v2v-probe-2009-"));
  const binary = join(directory, "ffprobe-fixture");
  const behavior = output === null
    ? `fs.writeFileSync(${JSON.stringify(marker)}, inputPath); setInterval(() => {}, 1000);`
    : `if (args.includes("-count_frames")) process.exit(41);
       const whitelist = args.indexOf("-protocol_whitelist");
       const entries = args.indexOf("-show_entries");
       if (whitelist < 0 || args[whitelist + 1] !== "file" || entries < 0 ||
           !args[entries + 1].includes("stream_disposition=attached_pic")) process.exit(42);
       fs.writeFileSync(${JSON.stringify(marker)}, inputPath);
       process.stdout.write(${JSON.stringify(output)});`;
  const source = `#!${process.execPath}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nconst inputPath = args.at(-1);\nif (!inputPath || !fs.statSync(inputPath).isFile()) process.exit(40);\n${behavior}\n`;
  await writeFile(binary, source, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { binary: await realpath(binary), directory };
}

function request(ffprobePath: string, bytes = mp4Bytes(), overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { model_id: "flux3_v2v", filename: "source.mp4", mime_type: "video/mp4", bytes, ffprobePath, ...overrides };
}

test("returns a branded metadata-only MP4 probe for a long input with audio and no inferred duration/frame cap", async () => {
  const marker = join(tmpdir(), `syntx-flux3-v2v-probe-marker-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(ffprobeOutput([
    { codec_type: "video", codec_name: "unlistedcodec", width: 7_680, height: 4_320, duration: "240.5", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "unlistedaudio", duration: "240.8" }
  ]), marker);
  try {
    const bytes = mp4Bytes();
    const result = await probeOwnerFlux3V2vOriginal(request(fixture.binary, bytes));
    assert.equal(isOwnerFlux3V2vOriginalProbe(result), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.model_id, "flux3_v2v");
    assert.equal(result.ai_name, "flux3_video");
    assert.equal(result.source_catalog_version, "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
    assert.equal(result.filename, "source.mp4");
    assert.equal(result.mime_type, "video/mp4");
    assert.equal(result.bytes_copied, 28);
    assert.match(result.source_sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(result.metadata, {
      container: "ISO_BMFF_MP4",
      video: { codec_name: "unlistedcodec", width: 7_680, height: 4_320, duration_seconds: 240.5 },
      container_duration_seconds: 240.8,
      audio_stream_count: 1,
      local_supported_input_limitation: "LOCAL_ONE_NON_ATTACHED_VIDEO_STREAM_METADATA_ONLY",
      inspection: "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE"
    });
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal("frame_count" in result.metadata.video, false);
    assert.equal("url" in result, false);
    assert.deepEqual(readOwnerFlux3V2vOriginalProbeBytes(result), bytes);
    const probedPath = await readFile(marker, "utf8");
    assert.equal(probedPath.endsWith("/source.mp4"), true);
    await assert.rejects(access(probedPath));
    releaseOwnerFlux3V2vOriginalProbe(result);
    assert.equal(isOwnerFlux3V2vOriginalProbe(result), false);
    assert.throws(() => readOwnerFlux3V2vOriginalProbeBytes(result), OwnerFlux3V2vOriginalProbeError);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("rejects multiple video streams and attached-picture streams as an explicit local limitation", async () => {
  const outputs = [
    ffprobeOutput([
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 0 } },
      { codec_type: "video", codec_name: "mjpeg", width: 320, height: 320, duration: "3", disposition: { attached_pic: 0 } }
    ]),
    ffprobeOutput([
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 1 } }
    ])
  ];
  for (const output of outputs) {
    const fixture = await executableProbe(output, join(tmpdir(), `syntx-flux3-v2v-invalid-${process.pid}-${Date.now()}`));
    try {
      await assert.rejects(probeOwnerFlux3V2vOriginal(request(fixture.binary)), (error: unknown) =>
        error instanceof OwnerFlux3V2vOriginalProbeError && error.code === "UNSUPPORTED_LOCAL_INPUT");
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  }
});

test("requires a positive observed duration but preserves a valid container-only fallback", async () => {
  const noDuration = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, disposition: { attached_pic: 0 } }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" }
  });
  const missingFixture = await executableProbe(noDuration, join(tmpdir(), `syntx-flux3-v2v-no-duration-${process.pid}-${Date.now()}`));
  try {
    await assert.rejects(probeOwnerFlux3V2vOriginal(request(missingFixture.binary)), (error: unknown) =>
      error instanceof OwnerFlux3V2vOriginalProbeError && error.code === "UNSUPPORTED_LOCAL_INPUT");
  } finally { await rm(missingFixture.directory, { recursive: true, force: true }); }

  const containerOnly = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, disposition: { attached_pic: 0 } }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "4.75" }
  });
  const fallbackFixture = await executableProbe(containerOnly, join(tmpdir(), `syntx-flux3-v2v-container-duration-${process.pid}-${Date.now()}`));
  try {
    const result = await probeOwnerFlux3V2vOriginal(request(fallbackFixture.binary));
    assert.equal(result.metadata.video.duration_seconds, 4.75);
    assert.equal(result.metadata.container_duration_seconds, 4.75);
    releaseOwnerFlux3V2vOriginalProbe(result);
  } finally { await rm(fallbackFixture.directory, { recursive: true, force: true }); }
});

test("rejects filenames that are not safe portable basenames", async () => {
  const marker = join(tmpdir(), `syntx-flux3-v2v-unsafe-name-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(ffprobeOutput([
    { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 0 } }
  ]), marker);
  try {
    for (const filename of ["CON.mp4", "bad:name.mp4", "bad?.mp4", "bad|name.mp4"]) {
      await assert.rejects(probeOwnerFlux3V2vOriginal(request(fixture.binary, mp4Bytes(), { filename })), OwnerFlux3V2vOriginalProbeError, filename);
    }
    assert.equal((await readFile(marker).catch(() => Buffer.alloc(0))).length, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("rejects foreign identity, non-MP4 inputs, unsafe binary paths, and bytes over the catalog cap", async () => {
  const marker = join(tmpdir(), `syntx-flux3-v2v-invalid-marker-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(ffprobeOutput([
    { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 0 } }
  ]), marker);
  try {
    const original = request(fixture.binary);
    await assert.rejects(probeOwnerFlux3V2vOriginal({ ...original, model_id: "flux3_i2v" }), OwnerFlux3V2vOriginalProbeError);
    await assert.rejects(probeOwnerFlux3V2vOriginal({ ...original, filename: "source.mov", mime_type: "video/quicktime" }), OwnerFlux3V2vOriginalProbeError);
    await assert.rejects(probeOwnerFlux3V2vOriginal(request(fixture.binary, new Uint8Array(52_428_801))), (error: unknown) =>
      error instanceof OwnerFlux3V2vOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    await assert.rejects(probeOwnerFlux3V2vOriginal({ ...original, ffprobePath: "relative/ffprobe" }), OwnerFlux3V2vOriginalProbeError);
    await chmod(fixture.binary, 0o722);
    await assert.rejects(probeOwnerFlux3V2vOriginal(original), (error: unknown) =>
      error instanceof OwnerFlux3V2vOriginalProbeError && error.code === "INVALID_ORIGINAL");
    assert.equal((await readFile(marker).catch(() => Buffer.alloc(0))).length, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("midflight abort drains ffprobe before wiping and removing the private source", async () => {
  const marker = join(tmpdir(), `syntx-flux3-v2v-abort-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(null, marker);
  try {
    const controller = new AbortController();
    const pending = probeOwnerFlux3V2vOriginal(request(fixture.binary), controller.signal);
    let inputPath: string | undefined;
    for (let attempt = 0; attempt < 100 && !inputPath; attempt += 1) {
      try { inputPath = await readFile(marker, "utf8"); }
      catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert.ok(inputPath, "ffprobe fixture must start before the abort");
    controller.abort();
    await assert.rejects(pending, (error: unknown) =>
      error instanceof OwnerFlux3V2vOriginalProbeError && error.code === "PROBE_ABORTED");
    await assert.rejects(access(inputPath));
    await assert.rejects(access(dirname(inputPath)));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});
