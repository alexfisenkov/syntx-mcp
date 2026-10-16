import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants as fsConstants, existsSync, realpathSync } from "node:fs";
import { access, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY,
  OwnerWan27VideoEditVideoPolicyError,
  isValidatedOwnerWan27VideoEditVideo,
  readValidatedOwnerWan27VideoEditVideo,
  releaseValidatedOwnerWan27VideoEditVideo,
  validateOwnerWan27VideoEditVideo
} from "../src/application/owner-wan27-videoedit-video-policy.js";
import { minimalWan27Mp4Header, wan27VideoEditProbeFixture, WAN27_VIDEOEDIT_PROBE_STREAMS } from "./helpers/wan27-videoedit-fixtures-2163.js";

const FFMPEG_CANDIDATE = process.env.SYNTX_WAN27_VIDEOEDIT_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE_CANDIDATE = process.env.SYNTX_WAN27_VIDEOEDIT_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const FFMPEG = existsSync(FFMPEG_CANDIDATE) ? realpathSync(FFMPEG_CANDIDATE) : FFMPEG_CANDIDATE;
const FFPROBE = existsSync(FFPROBE_CANDIDATE) ? realpathSync(FFPROBE_CANDIDATE) : FFPROBE_CANDIDATE;
const HAS_REAL_MEDIA_TOOLS = existsSync(FFMPEG) && existsSync(FFPROBE);

async function makeFfprobe(output: string, options: { readonly delayMs?: number; readonly markerPath?: string; readonly exitCode?: number; readonly stdoutBytes?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-video-probe-fixture-"));
  const interpreter = join(directory, "node");
  const executable = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const script = `#!${interpreter}\n` +
    `const fs=require("node:fs");const path=require("node:path");const args=process.argv.slice(2);\n` +
    `const whitelist=args.indexOf("-protocol_whitelist");if(whitelist<0||args[whitelist+1]!=="file,pipe")process.exit(31);\n` +
    `const input=args[args.length-1];const stat=fs.statSync(input);if(!stat.isFile())process.exit(32);\n` +
    (options.markerPath ? `fs.writeFileSync(${JSON.stringify(options.markerPath)},JSON.stringify({input,directory:path.dirname(input),file_mode:stat.mode&0o777,directory_mode:fs.statSync(path.dirname(input)).mode&0o777,size:stat.size}));\n` : "") +
    (options.delayMs ? `setTimeout(()=>process.stdout.write(${JSON.stringify(output)}),${options.delayMs});\n` :
      options.stdoutBytes ? `process.stdout.write("x".repeat(${options.stdoutBytes}));\n` : `process.stdout.write(${JSON.stringify(output)});\n`) +
    (options.exitCode ? `process.exitCode=${options.exitCode};\n` : "");
  await writeFile(executable, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await access(executable, fsConstants.X_OK);
  return { directory, executable: realpathSync(executable) };
}

function input(bytes: Uint8Array, ffprobePath: string, overrides: Partial<{ filename: string; mime_type: string; maxFileBytes: number }> = {}): Record<string, unknown> {
  return { filename: "source.mp4", mime_type: "video/mp4", bytes, ffprobePath, ...overrides };
}

async function expectPolicyError(request: unknown, code: OwnerWan27VideoEditVideoPolicyError["code"], signal?: AbortSignal) {
  await assert.rejects(validateOwnerWan27VideoEditVideo(request, signal), (error: unknown) =>
    error instanceof OwnerWan27VideoEditVideoPolicyError && error.code === code);
}

test("policy is the exact C19 videoedit source slice, not a K4 video alias", () => {
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.model_id, "wan_27_videoedit");
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.source_catalog_version,
    "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
  assert.deepEqual(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.source_mime_types, ["video/mp4", "video/quicktime"]);
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.source_max_file_size_bytes, 100 * 1024 * 1024);
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.local_default_max_file_size_bytes, 64 * 1024 * 1024);
  assert.deepEqual(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.local_configurable_max_file_size_bytes, { min: 1, max: 100 * 1024 * 1024 });
  assert.deepEqual([OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.min_width, OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.max_width,
    OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.min_height, OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.max_height], [240, 4096, 240, 4096]);
  assert.deepEqual([OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.min_duration_seconds, OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.max_duration_seconds], [2, 10]);
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.aspect_ratio_limit, null);
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.hdr_restriction, false);
  assert.equal(OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.crop_performed, false);
});

test("uses MAX audio/video track end in seconds and keeps a genuine owned byte snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-marker-"));
  const markerPath = join(directory, "probe-marker.json");
  const probe = await makeFfprobe(wan27VideoEditProbeFixture({ format_duration: "99.000000", streams: [
    { ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, color_transfer: "smpte2084" },
    WAN27_VIDEOEDIT_PROBE_STREAMS[1]!
  ] }), { markerPath });
  const callerBytes = minimalWan27Mp4Header();
  const before = Buffer.from(callerBytes);
  try {
    const receipt = await validateOwnerWan27VideoEditVideo(input(callerBytes, probe.executable));
    assert.equal(isValidatedOwnerWan27VideoEditVideo(receipt), true);
    assert.equal(receipt.model_id, "wan_27_videoedit");
    assert.equal(receipt.width, 320);
    assert.equal(receipt.height, 240);
    assert.equal(receipt.duration_seconds, 4.25);
    assert.equal(receipt.generation_permit, false);
    assert.equal(receipt.upload_binding, "NOT_ESTABLISHED");
    assert.equal(receipt.pixel_decode, false);
    assert.deepEqual(callerBytes, before);

    const marker = JSON.parse(await readFile(markerPath, "utf8")) as { input: string; directory: string; file_mode: number; directory_mode: number; size: number };
    assert.equal(marker.file_mode, 0o600);
    assert.equal(marker.directory_mode, 0o700);
    assert.equal(marker.size, before.byteLength);
    await assert.rejects(lstat(marker.input), { code: "ENOENT" });
    await assert.rejects(lstat(marker.directory), { code: "ENOENT" });

    const copyA = readValidatedOwnerWan27VideoEditVideo(receipt);
    assert.ok(copyA);
    assert.deepEqual(Buffer.from(copyA.bytes), before);
    assert.equal(copyA.sha256, receipt.source_sha256);
    copyA.bytes.fill(0);
    const copyB = readValidatedOwnerWan27VideoEditVideo(receipt);
    assert.ok(copyB);
    assert.deepEqual(Buffer.from(copyB.bytes), before);
    assert.notEqual(copyA.bytes, copyB.bytes);
    assert.equal(releaseValidatedOwnerWan27VideoEditVideo(receipt), true);
    assert.equal(isValidatedOwnerWan27VideoEditVideo(receipt), false);
    assert.equal(readValidatedOwnerWan27VideoEditVideo(receipt), null);
    assert.equal(releaseValidatedOwnerWan27VideoEditVideo(receipt), false);
    assert.deepEqual(callerBytes, before);
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires the MP4 or QuickTime MIME to match a bounded ftyp major brand", async () => {
  const probe = await makeFfprobe(wan27VideoEditProbeFixture());
  try {
    await expectPolicyError(input(minimalWan27Mp4Header("qt  "), probe.executable), "INVALID_INPUT");
    await expectPolicyError(input(minimalWan27Mp4Header("isom"), probe.executable,
      { filename: "source.mov", mime_type: "video/quicktime" }), "INVALID_INPUT");
    const malformedBox = minimalWan27Mp4Header();
    malformedBox.writeUInt32BE(23, 0);
    await expectPolicyError(input(malformedBox, probe.executable), "INVALID_INPUT");
  } finally { await rm(probe.directory, { recursive: true, force: true }); }
});

test("rejects Uint8Array subclasses and malformed trailing high surrogates", async () => {
  const probe = await makeFfprobe(wan27VideoEditProbeFixture());
  class CustomBytes extends Uint8Array {}
  try {
    await expectPolicyError(input(new CustomBytes(minimalWan27Mp4Header()), probe.executable), "INVALID_INPUT");
    await expectPolicyError(input(minimalWan27Mp4Header(), probe.executable, { filename: "bad\ud800.mp4" }), "INVALID_INPUT");
  } finally { await rm(probe.directory, { recursive: true, force: true }); }
});

test("accepts inclusive image-side and duration boundaries without an aspect or HDR rule", async () => {
  const probe = await makeFfprobe(wan27VideoEditProbeFixture({ streams: [
    { ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, width: 240, height: 4096, start_time: "0", start_pts: 0, duration: "2", duration_ts: 2000, time_base: "1/1000", color_transfer: "smpte2084" }
  ] }));
  try {
    const receipt = await validateOwnerWan27VideoEditVideo(input(minimalWan27Mp4Header(), probe.executable));
    assert.equal(receipt.duration_seconds, 2);
    assert.equal(receipt.width, 240);
    assert.equal(receipt.height, 4096);
    assert.equal(isValidatedOwnerWan27VideoEditVideo(receipt), true);
    assert.equal(releaseValidatedOwnerWan27VideoEditVideo(receipt), true);
  } finally { await rm(probe.directory, { recursive: true, force: true }); }

  const movProbe = await makeFfprobe(wan27VideoEditProbeFixture({ streams: [
    { ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, width: 4096, height: 240, start_time: "0", start_pts: 0, duration: "10", duration_ts: 10000, time_base: "1/1000" }
  ] }));
  try {
    const receipt = await validateOwnerWan27VideoEditVideo(input(minimalWan27Mp4Header("qt  "), movProbe.executable,
      { filename: "source.mov", mime_type: "video/quicktime" }));
    assert.equal(receipt.duration_seconds, 10);
    assert.equal(receipt.width, 4096);
    assert.equal(receipt.height, 240);
    assert.equal(releaseValidatedOwnerWan27VideoEditVideo(receipt), true);
  } finally { await rm(movProbe.directory, { recursive: true, force: true }); }
});

test("rejects MIME/extension mismatches, invalid caps, metadata outside C19/first-slice limits, and non-finite track ends", async () => {
  const probe = await makeFfprobe(wan27VideoEditProbeFixture());
  try {
    await expectPolicyError(input(minimalWan27Mp4Header(), probe.executable, { filename: "source.mov", mime_type: "video/mp4" }), "INVALID_INPUT");
    await expectPolicyError(input(minimalWan27Mp4Header(), probe.executable, { maxFileBytes: 100 * 1024 * 1024 + 1 }), "INVALID_INPUT");
    await expectPolicyError(input(minimalWan27Mp4Header(), probe.executable, { maxFileBytes: 1 }), "LOCAL_RESOURCE_LIMIT_EXCEEDED");
  } finally { await rm(probe.directory, { recursive: true, force: true }); }

  const cases: ReadonlyArray<{ readonly code: OwnerWan27VideoEditVideoPolicyError["code"]; readonly json: string }> = [
    { code: "SOURCE_LIMIT_EXCEEDED", json: wan27VideoEditProbeFixture({ streams: [{ ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, width: 239 }] }) },
    { code: "SOURCE_LIMIT_EXCEEDED", json: wan27VideoEditProbeFixture({ streams: [{ ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, height: 4097 }] }) },
    { code: "SOURCE_LIMIT_EXCEEDED", json: wan27VideoEditProbeFixture({ streams: [{ ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, start_time: "0", start_pts: 0, duration: "1.999", duration_ts: 1999 }] }) },
    { code: "SOURCE_LIMIT_EXCEEDED", json: wan27VideoEditProbeFixture({ streams: [{ ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, start_time: "0.001", start_pts: 1, duration: "10", duration_ts: 10000 }] }) },
    { code: "UNSUPPORTED_MEDIA_METADATA", json: wan27VideoEditProbeFixture({ streams: [{ ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, start_time: "N/A", start_pts: "N/A" }] }) },
    { code: "UNSUPPORTED_MEDIA_METADATA", json: wan27VideoEditProbeFixture({ streams: [{ ...WAN27_VIDEOEDIT_PROBE_STREAMS[0]!, time_base: "0/0" }] }) }
  ];
  for (const [index, entry] of cases.entries()) {
    const fake = await makeFfprobe(entry.json);
    try { await expectPolicyError(input(minimalWan27Mp4Header(), fake.executable), entry.code).catch((error: unknown) => {
      throw new Error(`metadata case ${index} failed: ${error instanceof Error ? error.message : "unexpected result"}`);
    }); }
    finally { await rm(fake.directory, { recursive: true, force: true }); }
  }
});

test("rejects forged receipts and foreign/proxy input objects", async () => {
  const probe = await makeFfprobe(wan27VideoEditProbeFixture());
  try {
    const receipt = await validateOwnerWan27VideoEditVideo(input(minimalWan27Mp4Header(), probe.executable));
    assert.equal(isValidatedOwnerWan27VideoEditVideo(Object.freeze({ ...receipt })), false);
    assert.equal(isValidatedOwnerWan27VideoEditVideo(new Proxy(receipt, {})), false);
    const maliciousInput = new Proxy(input(minimalWan27Mp4Header(), probe.executable), {});
    await expectPolicyError(maliciousInput, "INVALID_INPUT");
    assert.equal(releaseValidatedOwnerWan27VideoEditVideo(receipt), true);
  } finally { await rm(probe.directory, { recursive: true, force: true }); }
});

test("aborts the fresh ffprobe child and removes its private input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-abort-marker-"));
  const markerPath = join(directory, "probe-marker.json");
  const probe = await makeFfprobe(wan27VideoEditProbeFixture(), { markerPath, delayMs: 2_000 });
  const controller = new AbortController();
  const request = validateOwnerWan27VideoEditVideo(input(minimalWan27Mp4Header(), probe.executable), controller.signal);
  setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(request, (error: unknown) => error instanceof OwnerWan27VideoEditVideoPolicyError && error.code === "PROBE_ABORTED");
    if (existsSync(markerPath)) {
      const marker = JSON.parse(await readFile(markerPath, "utf8")) as { input: string; directory: string };
      await assert.rejects(lstat(marker.input), { code: "ENOENT" });
      await assert.rejects(lstat(marker.directory), { code: "ENOENT" });
    }
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects over-limit ffprobe JSON and still removes its private input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-output-marker-"));
  const markerPath = join(directory, "probe-marker.json");
  const probe = await makeFfprobe("", { markerPath, stdoutBytes: 70 * 1024 });
  try {
    await expectPolicyError(input(minimalWan27Mp4Header(), probe.executable), "PROBE_FAILED");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as { input: string; directory: string };
    await assert.rejects(lstat(marker.input), { code: "ENOENT" });
    await assert.rejects(lstat(marker.directory), { code: "ENOENT" });
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("real ffprobe measures a locally generated MP4 whose audio track ends after video", { skip: !HAS_REAL_MEDIA_TOOLS }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-real-mp4-"));
  const videoPath = join(directory, "trimmed-source.mp4");
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=10:d=2.5",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=4", "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac",
      "-movflags", "+faststart", videoPath], { timeout: 30_000, windowsHide: true });
    const bytes = await readFile(videoPath);
    const receipt = await validateOwnerWan27VideoEditVideo(input(bytes, FFPROBE));
    assert.equal(receipt.model_id, "wan_27_videoedit");
    assert.equal(receipt.duration_seconds, 4);
    assert.equal(receipt.width, 320);
    assert.equal(receipt.height, 240);
    assert.equal(receipt.pixel_decode, false);
    assert.equal(receipt.generation_permit, false);
    assert.ok(readValidatedOwnerWan27VideoEditVideo(receipt));
    assert.equal(releaseValidatedOwnerWan27VideoEditVideo(receipt), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
