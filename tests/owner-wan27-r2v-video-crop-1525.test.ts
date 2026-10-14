import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyTrustedOwnerWan27R2vVideoCropBytes, createOwnerWan27R2vVideoCropProcessor,
  isTrustedOwnerWan27R2vVideoCropReceipt, OwnerWan27R2vVideoCropError,
  releaseTrustedOwnerWan27R2vVideoCropReceipt
} from "../src/application/owner-wan27-r2v-video-crop.js";
import { createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "../src/application/owner-wan27-r2v-original-probe.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";

const run = promisify(execFile);
const MEDIA_TOOLS = [
  { ffmpegPath: "/opt/homebrew/bin/ffmpeg", ffprobePath: "/opt/homebrew/bin/ffprobe" },
  { ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpegPath) && existsSync(pair.ffprobePath));

async function availableTools(t: { skip: (message?: string) => void }): Promise<typeof MEDIA_TOOLS> {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return undefined; }
  try { await run(MEDIA_TOOLS.ffmpegPath, ["-version"]); await run(MEDIA_TOOLS.ffprobePath, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return undefined; }
  return MEDIA_TOOLS;
}

async function fixture(tools: NonNullable<typeof MEDIA_TOOLS>): Promise<{ root: string; original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> }> {
  const root = await mkdtemp(join(tmpdir(), "syntx-wan27-crop-test-")), path = join(root, "source.mp4");
  await run(tools.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path]);
  const bytes = new Uint8Array(await readFile(path));
  const original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: tools.ffprobePath }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes });
  bytes.fill(0); return { root, original };
}

test("selected crop is locally encoded, frame verified, byte-owned, and bound to the original selection", async (t) => {
  const tools = await availableTools(t); if (!tools) return;
  const { root, original } = await fixture(tools);
  try {
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 1 });
    const processor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: tools.ffmpegPath, ffprobePath: tools.ffprobePath });
    const receipt = await processor.crop(original, selection);
    try {
      assert.ok(isTrustedOwnerWan27R2vVideoCropReceipt(receipt));
      assert.equal(receipt.source_policy_id, original.source_policy_id);
      assert.equal(receipt.selection_policy_id, "OWNER_WAN27_R2V_SELECTED_VIDEO_FRAME_POLICY_V1");
      assert.equal(receipt.crop_policy_id, "OWNER_WAN27_R2V_LOCAL_CFR_CROP_V1");
      assert.notEqual(receipt.selection_policy_id, receipt.crop_policy_id);
      assert.equal(receipt.metadata.frame_count, 24);
      assert.equal(receipt.metadata.video_duration_seconds, 1);
      assert.equal(receipt.metadata.audio_stream_count, 1);
      assert.equal(receipt.encoding_policy, "CFR_LOCAL_ENCODING_NOT_PROVIDER_PROOF");
      assert.equal(receipt.generation_permit, false);
      assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
      const a = copyTrustedOwnerWan27R2vVideoCropBytes(receipt), b = copyTrustedOwnerWan27R2vVideoCropBytes(receipt);
      assert.notEqual(a.buffer, b.buffer); assert.deepEqual(a, b); a.fill(0);
      await assert.rejects(processor.crop({ ...original }, selection), OwnerWan27R2vVideoCropError);
      releaseTrustedOwnerWan27R2vVideoCropReceipt(receipt);
      assert.equal(isTrustedOwnerWan27R2vVideoCropReceipt(receipt), false);
      assert.throws(() => copyTrustedOwnerWan27R2vVideoCropBytes(receipt), OwnerWan27R2vVideoCropError);
    } finally { if (isTrustedOwnerWan27R2vVideoCropReceipt(receipt)) releaseTrustedOwnerWan27R2vVideoCropReceipt(receipt); }
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});

test("fixed local processor accepts only an authentic selection bound to its exact original receipt", async (t) => {
  const tools = await availableTools(t); if (!tools) return;
  const { root, original } = await fixture(tools);
  let other: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
  try {
    const source = new Uint8Array(await readFile(join(root, "source.mp4")));
    other = await createOwnerWan27R2vOriginalProbe({ ffprobePath: tools.ffprobePath }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes: source }); source.fill(0);
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 1 });
    const fakeFfmpeg = join(root, "fixture-ffmpeg"), fakeFfprobe = join(root, "fixture-ffprobe");
    const output = JSON.stringify({ streams: [
      { codec_type: "video", codec_name: "h264", width: 320, height: 240, avg_frame_rate: "24/1", nb_read_frames: "24", duration: "1.000000" },
      { codec_type: "audio", codec_name: "aac" }
    ], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } });
    await writeFile(fakeFfmpeg, "#!/bin/sh\nfor arg do out=$arg; done\n[ \"$(stat -f %Lp \"$out\")\" = 600 ] || exit 31\nprintf 'synthetic crop bytes' > \"$out\"\n", { mode: 0o700 });
    await writeFile(fakeFfprobe, `#!/bin/sh\nprintf '%s' '${output}'\n`, { mode: 0o700 });
    await chmod(fakeFfmpeg, 0o700); await chmod(fakeFfprobe, 0o700);
    const processor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: fakeFfmpeg, ffprobePath: fakeFfprobe });
    await assert.rejects(processor.crop(other, selection), OwnerWan27R2vVideoCropError);
    const receipt = await processor.crop(original, selection);
    try { assert.equal(Buffer.from(copyTrustedOwnerWan27R2vVideoCropBytes(receipt)).toString(), "synthetic crop bytes"); }
    finally { releaseTrustedOwnerWan27R2vVideoCropReceipt(receipt); }

    const capped = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, video_reference_count: 5 });
    const overCap = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 320, height: 240,
      avg_frame_rate: "24/1", nb_read_frames: "24", duration: "1.01" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } });
    await writeFile(fakeFfprobe, `#!/bin/sh\nprintf '%s' '${overCap}'\n`, { mode: 0o700 });
    await assert.rejects(processor.crop(original, capped), (error: unknown) => error instanceof OwnerWan27R2vVideoCropError && error.code === "INVALID_CROP");

    const oversizedFfmpeg = join(root, "oversized-ffmpeg");
    await writeFile(oversizedFfmpeg, "#!/bin/sh\nfor arg do out=$arg; done\ntruncate -s 104857601 \"$out\"\n", { mode: 0o700 }); await chmod(oversizedFfmpeg, 0o700);
    const oversizedProcessor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: oversizedFfmpeg, ffprobePath: fakeFfprobe });
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("syntx-wan27-r2v-crop-")));
    await assert.rejects(oversizedProcessor.crop(original, selection), (error: unknown) => error instanceof OwnerWan27R2vVideoCropError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith("syntx-wan27-r2v-crop-"));
    assert.deepEqual(after.filter((name) => !before.has(name)), []);
  } finally {
    releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
    if (other) releaseTrustedOwnerWan27R2vOriginalProbeResult(other);
    await rm(root, { recursive: true, force: true });
  }
});

test("aborted process is drained and its private temporary directory is removed", async (t) => {
  const tools = await availableTools(t); if (!tools) return;
  const { root, original } = await fixture(tools), before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("syntx-wan27-r2v-crop-")));
  const bin = join(root, "slow-ffmpeg");
  await writeFile(bin, "#!/bin/sh\nsleep 1\nexit 1\n", { mode: 0o700 }); await chmod(bin, 0o700);
  try {
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, video_reference_count: 1 });
    const controller = new AbortController(), processor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: bin, ffprobePath: tools.ffprobePath });
    const timer = setTimeout(() => controller.abort(), 100);
    await assert.rejects(processor.crop(original, selection, { signal: controller.signal }), (error: unknown) => error instanceof OwnerWan27R2vVideoCropError && error.code === "CROP_ABORTED");
    clearTimeout(timer);
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith("syntx-wan27-r2v-crop-"));
    assert.deepEqual(after.filter((name) => !before.has(name)), []);
  } finally { releaseTrustedOwnerWan27R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});
