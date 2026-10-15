import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult
} from "../src/application/owner-wan27-r2v-original-probe.js";
import {
  createOwnerWan27R2vVideoCropProcessor, copyTrustedOwnerWan27R2vVideoCropBytes,
  isTrustedOwnerWan27R2vVideoCropReceipt, releaseTrustedOwnerWan27R2vVideoCropReceipt
} from "../src/application/owner-wan27-r2v-video-crop.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerWan27R2vUploadReferenceForClient } from "../src/adapter/syntx/wan27-r2v-upload-context.js";

const exec = promisify(execFile);
const MEDIA_TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const VIDEO_URL = "https://r2.syntx.ai/hidden/selected-duration-1554.mp4";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("fixture-credential"); } };
}
function json(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }

test("selected-video context keeps frame-derived selection duration separate from measured container duration", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await exec(MEDIA_TOOLS.ffmpeg, ["-version"]); await exec(MEDIA_TOOLS.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }

  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-selected-duration-test-"));
  const sourcePath = join(directory, "source.mp4"), fakeFfprobe = join(directory, "fixture-ffprobe");
  let original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
  let crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>> | undefined;
  let cropBytes: Uint8Array | undefined;
  try {
    await exec(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: MEDIA_TOOLS.ffprobe }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes: sourceBytes });
    sourceBytes.fill(0);
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 1 });
    const selectedDuration = selection.frame_count * selection.frame_rate.denominator / selection.frame_rate.numerator;
    const measuredDuration = selectedDuration + 0.02;
    const audioCount = original.metadata.codec_streams.filter((stream) => stream.type === "audio").length;
    const fakeProbeOutput = JSON.stringify({ streams: [
      { codec_type: "video", codec_name: "h264", width: original.metadata.width, height: original.metadata.height,
        avg_frame_rate: `${selection.frame_rate.numerator}/${selection.frame_rate.denominator}`,
        nb_read_frames: String(selection.frame_count), duration: measuredDuration.toFixed(6) },
      ...Array.from({ length: audioCount }, () => ({ codec_type: "audio", codec_name: "aac" }))
    ], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } });
    await writeFile(fakeFfprobe, `#!/bin/sh\nprintf '%s' '${fakeProbeOutput}'\n`, { mode: 0o700 });
    await chmod(fakeFfprobe, 0o700);

    crop = await createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: MEDIA_TOOLS.ffmpeg, ffprobePath: fakeFfprobe }).crop(original, selection);
    assert.ok(isTrustedOwnerWan27R2vVideoCropReceipt(crop));
    assert.equal(crop.metadata.video_duration_seconds, measuredDuration);
    cropBytes = copyTrustedOwnerWan27R2vVideoCropBytes(crop);
    let requests = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
      requests += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      const form = init?.body as FormData;
      assert.equal(form.get("destination"), "hidden");
      const uploaded = form.get("files"); assert.ok(uploaded instanceof File);
      assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), cropBytes);
      return json({ files: [{ id: "selected-duration-1554", url: VIDEO_URL, filename: "wan27-r2v-selected-video.mp4",
        content_type: "video/mp4", duration: measuredDuration, size: uploaded.size }] });
    } });

    const context = await client.uploadWan27R2vSelectedVideo(crop);
    assert.equal(context.selected_duration_seconds, selectedDuration);
    assert.equal(context.video_duration_seconds, measuredDuration);
    assert.notEqual(context.selected_duration_seconds, context.video_duration_seconds);
    assert.ok(Math.abs(context.video_duration_seconds - context.selected_duration_seconds) <=
      selection.frame_rate.denominator / selection.frame_rate.numerator);
    assert.equal(context.sha256, crop.crop_sha256);
    assert.equal(context.source_sha256, original.source_sha256);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.hasOwn(context, "url"), false);
    assert.deepEqual(readOwnerWan27R2vUploadReferenceForClient(client, context), { url: VIDEO_URL });
    assert.equal(readOwnerWan27R2vUploadReferenceForClient(client, { ...context, selected_duration_seconds: measuredDuration }), null);
    assert.equal(requests, 1);
  } finally {
    cropBytes?.fill(0);
    if (crop && isTrustedOwnerWan27R2vVideoCropReceipt(crop)) releaseTrustedOwnerWan27R2vVideoCropReceipt(crop);
    if (original) releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
    await rm(directory, { recursive: true, force: true });
  }
});
