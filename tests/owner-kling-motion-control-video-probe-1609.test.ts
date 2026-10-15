import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY,
  OwnerKlingMotionControlVideoProbeError,
  createOwnerKlingMotionControlVideoProbe,
  copyTrustedOwnerKlingMotionControlVideoBytes,
  isTrustedOwnerKlingMotionControlVideoProbeResult,
  releaseTrustedOwnerKlingMotionControlVideoProbeResult
} from "../src/application/owner-kling-motion-control-video-probe.js";

const FFMPEG = process.env.SYNTX_MCV_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_MCV_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
let directory: string;
let mp4: Buffer;
let mov: Buffer;
let short: Buffer;
let small: Buffer;
let hdr: Buffer;

test("prepare genuine local MP4, MOV, short, small and HDR fixtures", async () => {
  directory = await mkdtemp(join(tmpdir(), "syntx-mcv-1609-test-"));
  const make = (name: string, duration: string, size: string, transfer: string) => {
    const path = join(directory, name);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=red:s=${size}:r=24:d=${duration}`,
      "-vf", `setparams=colorspace=bt709:color_primaries=bt709:color_trc=${transfer}`, "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", "-y", path]);
    return path;
  };
  mp4 = await readFile(make("source spaces.mp4", "3.2", "320x320", "bt709"));
  mov = await readFile(make("source.mov", "3.2", "320x320", "bt709"));
  short = await readFile(make("short.mp4", "2.8", "320x320", "bt709"));
  small = await readFile(make("small.mp4", "3.2", "288x320", "bt709"));
  hdr = await readFile(make("hdr.mp4", "3.2", "320x320", "smpte2084"));
});

test("pins source facts separately from the local resource cap", () => {
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.model_id, "kling_motion_control");
  assert.deepEqual(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.source_mime_types, ["video/mp4", "video/quicktime"]);
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.source_max_file_size_bytes, null);
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.max_file_size_bytes, 100 * 1024 * 1024);
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.min_side, 300);
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.min_duration_seconds, 3);
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.max_duration_seconds, 30);
  assert.equal(OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.generation_permit, false);
});

test("accepts real MP4 and MOV and retains a private byte snapshot", async () => {
  const probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath: FFPROBE });
  for (const [bytes, filename, mime] of [[mp4, "video sample.mp4", "video/mp4"], [mov, "素材 clip.mov", "video/quicktime"]] as const) {
    const ownedInput = Buffer.from(bytes), original = Buffer.from(bytes);
    const pending = probe.probe({ filename, mime_type: mime, bytes: ownedInput });
    ownedInput.fill(0);
    const receipt = await pending;
    assert.equal(receipt.metadata_confidence, "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED");
    assert.equal(receipt.generation_permit, false);
    assert.equal(receipt.metadata.width, 320);
    assert.ok(receipt.metadata.duration_seconds >= 3 && receipt.metadata.duration_seconds <= 30);
    const copy = copyTrustedOwnerKlingMotionControlVideoBytes(receipt);
    assert.deepEqual(Buffer.from(copy), original);
    copy.fill(0);
    assert.equal(isTrustedOwnerKlingMotionControlVideoProbeResult(receipt), true);
    assert.equal(releaseTrustedOwnerKlingMotionControlVideoProbeResult(receipt), true);
  }
});

test("rejects source duration and dimension bounds", async () => {
  const probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath: FFPROBE });
  await assert.rejects(probe.probe({ filename: "short.mp4", mime_type: "video/mp4", bytes: short }), (e: unknown) =>
    e instanceof OwnerKlingMotionControlVideoProbeError && e.code === "SOURCE_LIMIT_EXCEEDED");
  await assert.rejects(probe.probe({ filename: "small.mp4", mime_type: "video/mp4", bytes: small }), (e: unknown) =>
    e instanceof OwnerKlingMotionControlVideoProbeError && e.code === "SOURCE_LIMIT_EXCEEDED");
});

test("rejects HDR, fake/cloned/released receipts, and input accessors", async () => {
  const probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath: FFPROBE });
  assert.equal(isTrustedOwnerKlingMotionControlVideoProbeResult(Object.freeze({ status: "TRUSTED_LOCAL_MEDIA_PROBE" })), false);
  await assert.rejects(probe.probe({ filename: "hdr.mp4", mime_type: "video/mp4", bytes: hdr }), (e: unknown) =>
    e instanceof OwnerKlingMotionControlVideoProbeError && e.code === "HDR_NOT_ALLOWED");
  const receipt = await probe.probe({ filename: "video.mp4", mime_type: "video/mp4", bytes: mp4 });
  assert.equal(isTrustedOwnerKlingMotionControlVideoProbeResult(Object.freeze({ ...receipt })), false);
  assert.equal(releaseTrustedOwnerKlingMotionControlVideoProbeResult(receipt), true);
  assert.throws(() => copyTrustedOwnerKlingMotionControlVideoBytes(receipt));
  let touched = false;
  const accessor = { get filename() { touched = true; return "x.mp4"; }, mime_type: "video/mp4", bytes: mp4 };
  await assert.rejects(probe.probe(accessor), (e: unknown) => e instanceof OwnerKlingMotionControlVideoProbeError && e.code === "INVALID_INPUT");
  assert.equal(touched, false);
  await assert.rejects(probe.probe({ filename: "video.mov", mime_type: "video/mp4", bytes: mp4 }),
    (e: unknown) => e instanceof OwnerKlingMotionControlVideoProbeError && e.code === "INVALID_INPUT");
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(probe.probe({ filename: "video.mp4", mime_type: "video/mp4", bytes: mp4 }, { signal: aborted.signal }),
    (e: unknown) => e instanceof OwnerKlingMotionControlVideoProbeError && e.code === "PROBE_ABORTED");
});

test.after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
