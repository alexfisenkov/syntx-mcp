import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOwnerWan27R2vOriginalProbe,
  isTrustedOwnerWan27R2vOriginalProbeResult,
  releaseTrustedOwnerWan27R2vOriginalProbeResult
} from "../src/application/owner-wan27-r2v-original-probe.js";
import {
  getOwnerWan27R2vVideoSelectionMetadata,
  OwnerWan27R2vVideoSelectionError,
  validateOwnerWan27R2vVideoSelection
} from "../src/application/owner-wan27-r2v-video-selection.js";

const OUTPUT = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080,
  avg_frame_rate: "30000/1001", r_frame_rate: "30/1", nb_read_frames: "301", duration: "10.043367" }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10.043367" } });

async function probedOriginal(ffprobeOutput = OUTPUT): Promise<{ result: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>>; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-r2v-selection-"));
  const binary = join(directory, "ffprobe-fixture");
  await writeFile(binary, `#!/bin/sh\nfor last do :; done\n[ -s "$last" ] || exit 32\nprintf '%s' '${ffprobeOutput.replaceAll("'", "'\\''")}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  const bytes = new Uint8Array(64);
  bytes.set([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
  const result = await createOwnerWan27R2vOriginalProbe({ ffprobePath: binary }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes });
  return { result, directory };
}

test("selection binds genuine source and records 30000/1001 frame-aligned metadata only", async () => {
  const { result: original, directory } = await probedOriginal();
  try {
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 2 });
    const metadata = getOwnerWan27R2vVideoSelectionMetadata(original, selection);
    assert.ok(metadata);
    assert.equal(Object.isFrozen(selection), true);
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(metadata.source_sha256, original.source_sha256);
    assert.equal(metadata.source_policy_id, original.source_policy_id);
    assert.deepEqual(metadata.frame_rate, { numerator: 30_000, denominator: 1_001 });
    assert.equal(metadata.requested_start_seconds, 0.25);
    assert.equal(metadata.requested_end_seconds, 1.25);
    assert.equal(metadata.effective_start_frame, 7);
    assert.equal(metadata.effective_end_frame, 37);
    assert.equal(metadata.frame_count, 30);
    assert.equal(metadata.duration_seconds, 1.001);
    assert.equal(metadata.per_video_cap_seconds, 2.5);
    assert.equal(metadata.generation_permit, false);
    assert.equal(metadata.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal(metadata.selection_crop, "NOT_PERFORMED");
    assert.deepEqual(Object.keys(metadata).sort(), ["duration_seconds", "effective_end_frame", "effective_end_seconds",
      "effective_start_frame", "effective_start_seconds", "frame_count", "frame_rate", "generation_permit",
      "owner_upload_binding", "per_video_cap_seconds", "requested_end_seconds", "requested_start_seconds",
      "selection_crop", "source_policy_id", "source_sha256", "video_reference_count"].sort());
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(directory, { recursive: true, force: true }); }
});

test("24 fps source permits a sub-second selected clip and rejects rounding past measured source end", async () => {
  const output = OUTPUT.replaceAll("30000/1001", "24/1").replaceAll("30/1", "24/1")
    .replaceAll("301", "25").replaceAll("10.043367", "1.03");
  const { result: original, directory } = await probedOriginal(output);
  try {
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.125, end_seconds: 0.875, video_reference_count: 1 });
    const metadata = getOwnerWan27R2vVideoSelectionMetadata(original, selection);
    assert.ok(metadata);
    assert.deepEqual(metadata.frame_rate, { numerator: 24, denominator: 1 });
    assert.equal(metadata.effective_start_frame, 3);
    assert.equal(metadata.effective_end_frame, 21);
    assert.equal(metadata.duration_seconds, 0.75);
    assert.ok(metadata.duration_seconds < 1);
    assert.throws(() => validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1.03, video_reference_count: 1 }), OwnerWan27R2vVideoSelectionError);
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(directory, { recursive: true, force: true }); }
});

test("selection uses source frame rate and rejects source or aggregate-cap crossings after rounding", async () => {
  const { result: original, directory } = await probedOriginal();
  try {
    const cap = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 2.47, video_reference_count: 2 });
    assert.equal(getOwnerWan27R2vVideoSelectionMetadata(original, cap)?.frame_count, 74);
    for (const input of [
      { original, start_seconds: 0, end_seconds: 2.502, video_reference_count: 2 },
      { original, start_seconds: 0, end_seconds: 10.043367, video_reference_count: 1 }
    ]) assert.throws(() => validateOwnerWan27R2vVideoSelection(input), OwnerWan27R2vVideoSelectionError);
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(directory, { recursive: true, force: true }); }
});

test("selection rejects frame alignment beyond the decoded frame count even when reported duration has room", async () => {
  const { result: original, directory } = await probedOriginal(OUTPUT.replaceAll("10.043367", "10.1"));
  try {
    assert.throws(() => validateOwnerWan27R2vVideoSelection({ original, start_seconds: 7.6, end_seconds: 10.07, video_reference_count: 2 }), OwnerWan27R2vVideoSelectionError);
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(directory, { recursive: true, force: true }); }
});

test("one through five selected videos divide the aggregate five-second cap and retain a one-frame minimum", async () => {
  const { result: original, directory } = await probedOriginal();
  try {
    for (let count = 1; count <= 5; count += 1) {
      const seconds = 5 / count - 0.04;
      const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: seconds, video_reference_count: count });
      assert.equal(getOwnerWan27R2vVideoSelectionMetadata(original, selection)?.video_reference_count, count);
    }
    const oneFrame = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1 / 30, video_reference_count: 5 });
    assert.equal(getOwnerWan27R2vVideoSelectionMetadata(original, oneFrame)?.frame_count, 1);
    assert.throws(() => validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 0.001, video_reference_count: 5 }), OwnerWan27R2vVideoSelectionError);
    assert.throws(() => validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 5.001, video_reference_count: 1 }), OwnerWan27R2vVideoSelectionError);
    assert.throws(() => validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, video_reference_count: 6 }), OwnerWan27R2vVideoSelectionError);
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(directory, { recursive: true, force: true }); }
});

test("selection rejects forged, cross-source, released, malformed and out-of-range requests", async () => {
  const { result: first, directory: firstDirectory } = await probedOriginal();
  const { result: second, directory: secondDirectory } = await probedOriginal();
  try {
    const selected = validateOwnerWan27R2vVideoSelection({ original: first, start_seconds: 1, end_seconds: 2, video_reference_count: 1 });
    assert.equal(getOwnerWan27R2vVideoSelectionMetadata(second, selected), null);
    assert.equal(getOwnerWan27R2vVideoSelectionMetadata(first, { ...selected }), null);
    for (const input of [
      { original: { ...first }, start_seconds: 1, end_seconds: 2, video_reference_count: 1 },
      { original: first, start_seconds: -0.1, end_seconds: 2, video_reference_count: 1 },
      { original: first, start_seconds: 2, end_seconds: 2, video_reference_count: 1 },
      { original: first, start_seconds: 0, end_seconds: 11, video_reference_count: 1 },
      { original: first, start_seconds: Number.NaN, end_seconds: 2, video_reference_count: 1 },
      { original: first, start_seconds: 0, end_seconds: 1, video_reference_count: 0 }
    ]) assert.throws(() => validateOwnerWan27R2vVideoSelection(input), OwnerWan27R2vVideoSelectionError);
    releaseTrustedOwnerWan27R2vOriginalProbeResult(first);
    assert.equal(getOwnerWan27R2vVideoSelectionMetadata(first, selected), null);
    assert.throws(() => validateOwnerWan27R2vVideoSelection({ original: first, start_seconds: 1, end_seconds: 2, video_reference_count: 1 }), OwnerWan27R2vVideoSelectionError);
  } finally {
    if (isTrustedOwnerWan27R2vOriginalProbeResult(first)) releaseTrustedOwnerWan27R2vOriginalProbeResult(first);
    if (isTrustedOwnerWan27R2vOriginalProbeResult(second)) releaseTrustedOwnerWan27R2vOriginalProbeResult(second);
    await Promise.all([rm(firstDirectory, { recursive: true, force: true }), rm(secondDirectory, { recursive: true, force: true })]);
  }
});
