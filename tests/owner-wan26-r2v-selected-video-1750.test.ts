import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createOwnerWan26R2vOriginalProbe, releaseTrustedOwnerWan26R2vOriginalProbeResult } from "../src/application/owner-wan26-r2v-original-probe.js";
import { validateOwnerWan26R2vVideoSelection, getOwnerWan26R2vVideoSelectionMetadata } from "../src/application/owner-wan26-r2v-video-selection.js";
import { copyTrustedOwnerWan26R2vVideoCropBytes, createOwnerWan26R2vVideoCropProcessor, isTrustedOwnerWan26R2vVideoCropReceipt, releaseTrustedOwnerWan26R2vVideoCropReceipt, OwnerWan26R2vVideoCropError } from "../src/application/owner-wan26-r2v-video-crop.js";

const run = promisify(execFile);
const TOOLS = [{ ffmpegPath: "/opt/homebrew/bin/ffmpeg", ffprobePath: "/opt/homebrew/bin/ffprobe" }, { ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" }].find((x) => existsSync(x.ffmpegPath) && existsSync(x.ffprobePath));
async function media(t: { skip: (why?: string) => void }) {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  await run(TOOLS.ffmpegPath, ["-version"]); await run(TOOLS.ffprobePath, ["-version"]);
  const root = await mkdtemp(join(tmpdir(), "syntx-wan26-1750-")), file = join(root, "source.mp4");
  await run(TOOLS.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=384x384:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  const bytes = new Uint8Array(await readFile(file));
  try { const original = await createOwnerWan26R2vOriginalProbe({ ffprobePath: TOOLS.ffprobePath }).probe({ model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes }); return { root, original }; }
  finally { bytes.fill(0); }
}

test("WAN26 selection divides by total reference count and rejects forged/out-of-source ranges", async (t) => {
  const fx = await media(t); if (!fx) return;
  try {
    const { original } = fx;
    const selection = validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, total_reference_count: 3 });
    assert.equal(selection.model_id, "wan_26_r2v"); assert.equal(selection.total_reference_count, 3);
    assert.equal(selection.per_video_cap_seconds, 5 / 3); assert.equal(selection.duration_seconds, 1);
    assert.equal(selection.generation_permit, false); assert.equal(selection.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal(getOwnerWan26R2vVideoSelectionMetadata(original, { ...selection }), null);
    assert.throws(() => validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1.7, total_reference_count: 3 }));
    assert.throws(() => validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, total_reference_count: 3, video_reference_count: 1 }));
    releaseTrustedOwnerWan26R2vOriginalProbeResult(original);
    assert.equal(getOwnerWan26R2vVideoSelectionMetadata(original, selection), null);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test("actual local ffmpeg probe-selection-crop-decode and byte lifecycle (including AbortSignal)", async (t) => {
  const fx = await media(t); if (!fx) return;
  const { root, original } = fx;
  try {
    const selection = validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, total_reference_count: 3 });
    const processor = createOwnerWan26R2vVideoCropProcessor(TOOLS!);
    const receipt = await processor.crop(original, selection);
    try {
      assert.ok(isTrustedOwnerWan26R2vVideoCropReceipt(receipt)); assert.equal(receipt.model_id, original.model_id);
      assert.equal(receipt.selection_policy_id, "OWNER_WAN26_R2V_SELECTED_VIDEO_FRAME_POLICY_V1");
      assert.equal(receipt.metadata.frame_count, selection.frame_count); assert.equal(receipt.metadata.audio_stream_count, 1);
      const bytes = copyTrustedOwnerWan26R2vVideoCropBytes(receipt), decoded = join(root, "decoded.mp4");
      await writeFile(decoded, bytes); bytes.fill(0);
      const { stdout } = await run(TOOLS!.ffprobePath, ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,nb_read_frames", "-of", "json", decoded]);
      assert.match(stdout, /"nb_read_frames"\s*:\s*"24"/);
      const controller = new AbortController(); controller.abort();
      await assert.rejects(processor.crop(original, selection, { signal: controller.signal }), (e: unknown) => e instanceof OwnerWan26R2vVideoCropError && e.code === "CROP_ABORTED");
      const slow = join(root, "slow-ffmpeg"); await writeFile(slow, "#!/bin/sh\nexec /bin/sleep 5\n", { mode: 0o700 }); await chmod(slow, 0o700);
      const runningController = new AbortController(), runningProcessor = createOwnerWan26R2vVideoCropProcessor({ ffmpegPath: slow, ffprobePath: TOOLS!.ffprobePath });
      const timer = setTimeout(() => runningController.abort(), 250);
      await assert.rejects(runningProcessor.crop(original, selection, { signal: runningController.signal }), (e: unknown) => e instanceof OwnerWan26R2vVideoCropError && e.code === "CROP_ABORTED");
      clearTimeout(timer);
    } finally { releaseTrustedOwnerWan26R2vVideoCropReceipt(receipt); }
  } finally { releaseTrustedOwnerWan26R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});

test("exact WAN26 Flash model is preserved and native caller model override is rejected", async (t) => {
  const fx = await media(t); if (!fx) return; const { root, original } = fx;
  try {
    const bytes = new Uint8Array(await readFile(join(root, "source.mp4")));
    const flash = await createOwnerWan26R2vOriginalProbe({ ffprobePath: TOOLS!.ffprobePath }).probe({ model_id: "wan_26_r2v_flash", filename: "source.mp4", mime_type: "video/mp4", bytes }); bytes.fill(0);
    try {
      const s = validateOwnerWan26R2vVideoSelection({ original: flash, start_seconds: 0, end_seconds: 1, total_reference_count: 1 });
      assert.equal(s.model_id, "wan_26_r2v_flash");
      assert.throws(() => validateOwnerWan26R2vVideoSelection({ original: flash, model_id: "wan_27_r2v", start_seconds: 0, end_seconds: 1, total_reference_count: 1 }));
    } finally { releaseTrustedOwnerWan26R2vOriginalProbeResult(flash); }
    assert.ok(original);
  } finally { releaseTrustedOwnerWan26R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});

test("crop options reject unrecognized own keys before invoking media tools", async (t) => {
  const fx = await media(t); if (!fx) return; const { root, original } = fx;
  try {
    const selection = validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, total_reference_count: 1 });
    const processor = createOwnerWan26R2vVideoCropProcessor(TOOLS!);
    await assert.rejects(processor.crop(original, selection, { unrelated: true } as never),
      (e: unknown) => e instanceof OwnerWan26R2vVideoCropError && e.code === "INVALID_CROP");
  } finally { releaseTrustedOwnerWan26R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});

test("original release during awaited output ffprobe revokes the pending crop", async (t) => {
  const fx = await media(t); if (!fx) return; const { root, original } = fx, marker = join(root, "ffprobe-started"), delayed = join(root, "delayed-ffprobe");
  const realProbe = TOOLS!.ffprobePath;
  await writeFile(delayed, `#!/bin/sh\n: > '${marker}'\n/bin/sleep 1\nexec '${realProbe}' "$@"\n`, { mode: 0o700 }); await chmod(delayed, 0o700);
  let originalLive = true;
  try {
    const selection = validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, total_reference_count: 1 });
    const processor = createOwnerWan26R2vVideoCropProcessor({ ffmpegPath: TOOLS!.ffmpegPath, ffprobePath: delayed });
    const pending = processor.crop(original, selection).then((receipt) => ({ receipt }), (error: unknown) => ({ error }));
    for (let i = 0; i < 200; i++) { try { await access(marker); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } }
    await access(marker);
    releaseTrustedOwnerWan26R2vOriginalProbeResult(original); originalLive = false;
    const result = await pending;
    if ("receipt" in result) releaseTrustedOwnerWan26R2vVideoCropReceipt(result.receipt);
    assert.ok("error" in result && result.error instanceof OwnerWan26R2vVideoCropError && result.error.code === "INVALID_CROP");
  } finally { if (originalLive) releaseTrustedOwnerWan26R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});

test("packetwise oversize crop output is removed from private temp storage", async (t) => {
  const fx = await media(t); if (!fx) return; const { root, original } = fx;
  const tool = join(root, "oversize-ffmpeg");
  await writeFile(tool, "#!/bin/sh\nfor arg do out=$arg; done\ntruncate -s 104857602 \"$out\"\n", { mode: 0o700 }); await chmod(tool, 0o700);
  try {
    const selection = validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0, end_seconds: 1, total_reference_count: 1 });
    const before = new Set((await readdir(tmpdir())).filter((x) => x.startsWith("syntx-wan26-r2v-crop-")));
    await assert.rejects(createOwnerWan26R2vVideoCropProcessor({ ffmpegPath: tool, ffprobePath: TOOLS!.ffprobePath }).crop(original, selection),
      (e: unknown) => e instanceof OwnerWan26R2vVideoCropError && e.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
    const after = (await readdir(tmpdir())).filter((x) => x.startsWith("syntx-wan26-r2v-crop-"));
    assert.deepEqual(after.filter((x) => !before.has(x)), []);
  } finally { releaseTrustedOwnerWan26R2vOriginalProbeResult(original); await rm(root, { recursive: true, force: true }); }
});
