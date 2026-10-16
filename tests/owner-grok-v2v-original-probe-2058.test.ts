import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  isOwnerGrokV2vOriginalProbe,
  OwnerGrokV2vOriginalProbeError,
  probeOwnerGrokV2vOriginal,
  readOwnerGrokV2vOriginalProbeBytes,
  releaseOwnerGrokV2vOriginalProbe
} from "../src/application/owner-grok-v2v-original-probe.js";

function mediaBytes(brand: "isom" | "qt  " = "isom"): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(brand), 8);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode(brand), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

type Stream = Record<string, unknown>;
function ffprobeOutput(streams: Stream[], containerDuration = "4.6", formatName = "mov,mp4,m4a,3gp,3g2,mj2"): string {
  return JSON.stringify({ streams, format: { format_name: formatName, duration: containerDuration } });
}

async function executableProbe(output: string, marker: string): Promise<{ binary: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-probe-2058-"));
  const binary = join(directory, "ffprobe-fixture");
  const source = `#!${process.execPath}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nconst inputPath = args.at(-1);\nif (!inputPath || !fs.statSync(inputPath).isFile()) process.exit(40);\nconst whitelist=args.indexOf("-protocol_whitelist"), entries=args.indexOf("-show_entries");\nif(whitelist<0 || args[whitelist+1]!=="file" || entries<0 || !args[entries+1].includes("stream_disposition=attached_pic")) process.exit(41);\nfs.writeFileSync(${JSON.stringify(marker)},inputPath);\nprocess.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(binary, source, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { binary: await realpath(binary), directory };
}

function request(ffprobePath: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { model_id: "grok_v2v", filename: "source.mp4", mime_type: "video/mp4", bytes: mediaBytes(), ffprobePath, ...overrides };
}

test("binds a private local probe to its source bytes and uses the maximum observed video/container duration",
  { skip: process.platform === "win32" ? "POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN" : false }, async () => {
  const marker = join(tmpdir(), `syntx-grok-v2v-probe-marker-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(ffprobeOutput([
    { codec_type: "video", codec_name: "h264", width: 854, height: 480, duration: "4.4", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "aac", duration: "4.6" }
  ]), marker);
  try {
    const bytes = mediaBytes();
    const result = await probeOwnerGrokV2vOriginal(request(fixture.binary, { bytes }));
    assert.equal(isOwnerGrokV2vOriginalProbe(result), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.model_id, "grok_v2v");
    assert.equal(result.ai_name, "grok_video");
    assert.equal(result.source_sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.source_size_bytes, bytes.byteLength);
    assert.equal(result.mime_type, "video/mp4");
    assert.equal(result.metadata.video.width, 854);
    assert.equal(result.metadata.video.height, 480);
    assert.equal(result.metadata.video.duration_seconds, 4.4);
    assert.equal(result.metadata.duration_seconds, 4.6);
    assert.equal(result.metadata.container_duration_seconds, 4.6);
    assert.equal(result.metadata.duration_confidence, "CONTAINER_DURATION_SECONDS_LOCAL_POLICY");
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    const consumerCopy = readOwnerGrokV2vOriginalProbeBytes(result);
    assert.deepEqual(consumerCopy, bytes);
    consumerCopy.fill(0);
    assert.deepEqual(readOwnerGrokV2vOriginalProbeBytes(result), bytes);
    assert.equal(isOwnerGrokV2vOriginalProbe({ ...result }), false);
    assert.equal(isOwnerGrokV2vOriginalProbe({ ...result, model_id: "flux3_v2v" }), false);
    const privatePath = await readFile(marker, "utf8");
    assert.ok(privatePath.endsWith("/source.mp4"));
    await assert.rejects(access(privatePath));
    await assert.rejects(access(dirname(privatePath)));
    releaseOwnerGrokV2vOriginalProbe(result);
    assert.equal(isOwnerGrokV2vOriginalProbe(result), false);
    assert.throws(() => readOwnerGrokV2vOriginalProbeBytes(result), OwnerGrokV2vOriginalProbeError);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("accepts exactly one second through 8.7 seconds before rounding, and recognizes QuickTime only with its matching MIME",
  { skip: process.platform === "win32" ? "POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN" : false }, async () => {
  for (const [duration, expected] of [["1", 1], ["8.7", 8.7]] as const) {
    const marker = join(tmpdir(), `syntx-grok-v2v-boundary-${process.pid}-${Date.now()}-${duration}`);
    const fixture = await executableProbe(ffprobeOutput([
      { codec_type: "video", codec_name: "h264", width: 640, height: 640, duration, disposition: { attached_pic: 0 } }
    ], duration), marker);
    try {
      const result = await probeOwnerGrokV2vOriginal(request(fixture.binary, { bytes: mediaBytes("qt  "), filename: "source.mov", mime_type: "video/quicktime" }));
      assert.equal(result.mime_type, "video/quicktime");
      assert.equal(result.metadata.container, "QUICKTIME_MOV");
      assert.equal(result.metadata.duration_seconds, expected);
      releaseOwnerGrokV2vOriginalProbe(result);
    } finally { await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
  }

  for (const duration of ["0.999", "8.704"]) {
    const marker = join(tmpdir(), `syntx-grok-v2v-outside-${process.pid}-${Date.now()}-${duration}`);
    const fixture = await executableProbe(ffprobeOutput([
      { codec_type: "video", codec_name: "h264", width: 640, height: 640, duration, disposition: { attached_pic: 0 } }
    ], duration), marker);
    try {
      await assert.rejects(probeOwnerGrokV2vOriginal(request(fixture.binary)), (error: unknown) =>
        error instanceof OwnerGrokV2vOriginalProbeError && error.code === "UNSUPPORTED_LOCAL_INPUT");
      const probedPath = await readFile(marker, "utf8");
      await assert.rejects(access(probedPath));
      await assert.rejects(access(dirname(probedPath)));
    } finally { await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
  }
});

test("rejects ambiguous streams, unsupported container claims, and probe paths outside the trusted boundary",
  { skip: process.platform === "win32" ? "POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN" : false }, async () => {
  const invalidOutputs = [
    ffprobeOutput([
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 0 } },
      { codec_type: "video", codec_name: "mjpeg", width: 320, height: 240, duration: "3", disposition: { attached_pic: 0 } }
    ]),
    ffprobeOutput([{ codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 1 } }]),
    ffprobeOutput([{ codec_type: "audio", codec_name: "aac", duration: "3" }]),
    ffprobeOutput([{ codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 0 } }], "3", "avi")
  ];
  for (const output of invalidOutputs) {
    const marker = join(tmpdir(), `syntx-grok-v2v-invalid-${process.pid}-${Date.now()}-${Math.random()}`);
    const fixture = await executableProbe(output, marker);
    try {
      await assert.rejects(probeOwnerGrokV2vOriginal(request(fixture.binary)), (error: unknown) =>
        error instanceof OwnerGrokV2vOriginalProbeError && error.code === "UNSUPPORTED_LOCAL_INPUT");
    } finally { await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
  }

  const marker = join(tmpdir(), `syntx-grok-v2v-guard-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(ffprobeOutput([
    { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "3", disposition: { attached_pic: 0 } }
  ]), marker);
  try {
    await assert.rejects(probeOwnerGrokV2vOriginal(request(fixture.binary, { model_id: "flux3_v2v" })), OwnerGrokV2vOriginalProbeError);
    await assert.rejects(probeOwnerGrokV2vOriginal(request(fixture.binary, { filename: "source.mov" })), OwnerGrokV2vOriginalProbeError);
    await assert.rejects(probeOwnerGrokV2vOriginal(request(fixture.binary, { ffprobePath: "relative/ffprobe" })), OwnerGrokV2vOriginalProbeError);
    await assert.rejects(probeOwnerGrokV2vOriginal(request(fixture.binary, { bytes: new Uint8Array(52_428_801) })),
      (error: unknown) => error instanceof OwnerGrokV2vOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    assert.equal((await readFile(marker).catch(() => Buffer.alloc(0))).length, 0);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
});

test("uses positive container timing when the video stream has no timestamp and reports the raw maximum",
  { skip: process.platform === "win32" ? "POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN" : false }, async () => {
  const marker = join(tmpdir(), `syntx-grok-v2v-container-duration-${process.pid}-${Date.now()}`);
  const fixture = await executableProbe(ffprobeOutput([
    { codec_type: "video", codec_name: "hevc", width: 1280, height: 720, duration: "N/A", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "aac", duration: "4.75" }
  ], "4.5"), marker);
  try {
    const result = await probeOwnerGrokV2vOriginal(request(fixture.binary));
    assert.equal(result.metadata.video.duration_seconds, null);
    assert.equal(result.metadata.container_duration_seconds, 4.5);
    assert.equal(result.metadata.duration_seconds, 4.75);
    releaseOwnerGrokV2vOriginalProbe(result);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
});
