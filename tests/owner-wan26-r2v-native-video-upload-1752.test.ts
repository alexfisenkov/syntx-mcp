import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerWan26R2vVideoUploadReferenceForClient } from "../src/adapter/syntx/wan26-r2v-video-upload-context.js";
import { createOwnerWan26R2vOriginalProbe, releaseTrustedOwnerWan26R2vOriginalProbeResult } from "../src/application/owner-wan26-r2v-original-probe.js";
import { validateOwnerWan26R2vVideoSelection } from "../src/application/owner-wan26-r2v-video-selection.js";
import { copyTrustedOwnerWan26R2vVideoCropBytes, createOwnerWan26R2vVideoCropProcessor, releaseTrustedOwnerWan26R2vVideoCropReceipt, type OwnerWan26R2vVideoCropReceipt } from "../src/application/owner-wan26-r2v-video-crop.js";

const run = promisify(execFile), SECRET = "wan26-r2v-native-upload-test-credential";
const TOOLS = [{ ffmpegPath: "/opt/homebrew/bin/ffmpeg", ffprobePath: "/opt/homebrew/bin/ffprobe" }, { ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" }]
  .find((x) => existsSync(x.ffmpegPath) && existsSync(x.ffprobePath));
function broker(): SyntxCredentialBroker { return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); } }; }
async function cropFixture(model_id: "wan_26_r2v" | "wan_26_r2v_flash") {
  if (!TOOLS) throw new Error("ffmpeg/ffprobe pair unavailable");
  const root = await mkdtemp(join(tmpdir(), "syntx-wan26-1752-")), source = join(root, "source.mp4");
  await run(TOOLS.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=384x384:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
  const input = new Uint8Array(await readFile(source));
  try {
    const original = await createOwnerWan26R2vOriginalProbe({ ffprobePath: TOOLS.ffprobePath }).probe({ model_id, filename: "source.mp4", mime_type: "video/mp4", bytes: input });
    try {
      const selection = validateOwnerWan26R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, total_reference_count: 2 });
      const receipt = await createOwnerWan26R2vVideoCropProcessor(TOOLS).crop(original, selection);
      return { root, original, receipt };
    } catch (error) { releaseTrustedOwnerWan26R2vOriginalProbeResult(original); throw error; }
  } finally { input.fill(0); }
}
function response(size: number, url = "https://r2.syntx.ai/uploaded/wan26-r2v-video.mp4", status = 200, model_type?: string): Response {
  return new Response(JSON.stringify({ files: [{ id: 1, url, filename: "wan26-r2v-selected-video.mp4", mime_type: "video/mp4",
    content_type: "video/mp4", media_type: "video", type: "video", size, duration: 1, ...(model_type ? { model_type } : {}) }] }),
  { status, headers: { "content-type": "application/json" } });
}

test("genuine local crops upload once for each exact WAN26 model and keep URL same-client private", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  for (const model_id of ["wan_26_r2v", "wan_26_r2v_flash"] as const) {
    const fx = await cropFixture(model_id); let calls = 0, retained: FormData | undefined;
    try {
      const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
        calls += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files"); assert.equal(init?.method, "POST");
        assert.ok(init?.body instanceof FormData); retained = init.body as FormData;
        assert.equal(retained.get("destination"), "uploaded"); assert.equal(retained.get("check_duplicates"), "true");
        assert.equal(retained.get("model_type"), model_id);
        const file = retained.get("files"); assert.ok(file instanceof File); assert.equal(file.type, "video/mp4");
        const expected = copyTrustedOwnerWan26R2vVideoCropBytes(fx.receipt);
        try { assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(expected)); } finally { expected.fill(0); }
        return response(file.size);
      } });
      const context = await client.uploadWan26R2vSelectedVideo(fx.receipt);
      assert.equal(calls, 1); assert.equal(context.model_id, model_id); assert.equal(context.media_type, "selected_video");
      assert.equal(context.mime_type, "video/mp4"); assert.equal(context.sha256, fx.receipt.crop_sha256);
      assert.equal(context.source_sha256, fx.receipt.source_sha256); assert.equal(context.frame_count, fx.receipt.metadata.frame_count);
      assert.equal(context.video_duration_seconds, fx.receipt.metadata.video_duration_seconds); assert.equal(Object.isFrozen(context), true);
      assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
      assert.deepEqual(readOwnerWan26R2vVideoUploadReferenceForClient(client, context), { url: "https://r2.syntx.ai/uploaded/wan26-r2v-video.mp4" });
      assert.equal(readOwnerWan26R2vVideoUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
      assert.equal(readOwnerWan26R2vVideoUploadReferenceForClient(client, { ...context }), null);
      assert.equal(retained?.get("files"), null);
      const borrowed = copyTrustedOwnerWan26R2vVideoCropBytes(fx.receipt); assert.ok(borrowed.length > 0); borrowed.fill(0);
    } finally { releaseTrustedOwnerWan26R2vVideoCropReceipt(fx.receipt); releaseTrustedOwnerWan26R2vOriginalProbeResult(fx.original); await rm(fx.root, { recursive: true, force: true }); }
  }
});

test("forged/released crops stop before POST; malformed, failed, and aborted requests mint no context and never retry", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  const fx = await cropFixture("wan_26_r2v_flash"); let calls = 0, cropLive = true,
    mode: "bad" | "crossmodel" | "http" | "abort" | "release" = "bad", releaseFetch: (() => void) | undefined,
    announceFetch: (() => void) | undefined;
  try {
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
      calls += 1;
      if (mode === "abort") return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      const form = init?.body as FormData, uploaded = form.get("files"); assert.ok(uploaded instanceof File);
      if (mode === "release") return await new Promise<Response>((resolve) => { announceFetch?.(); releaseFetch = () => resolve(response(uploaded.size)); });
      if (mode === "crossmodel") return response(uploaded.size, "https://r2.syntx.ai/uploaded/wan26-r2v-video.mp4", 200, "wan_27_r2v");
      if (mode === "http") return response(uploaded.size, "https://r2.syntx.ai/uploaded/wan26-r2v-video.mp4", 500);
      return new Response(JSON.stringify({ files: [{ id: 1, url: "https://evil.example/file.mp4", mime_type: "video/mp4", size: 12_000 }] }), { status: 200 });
    } });
    await assert.rejects(client.uploadWan26R2vSelectedVideo({ ...fx.receipt } as OwnerWan26R2vVideoCropReceipt)); assert.equal(calls, 0);
    mode = "bad"; await assert.rejects(client.uploadWan26R2vSelectedVideo(fx.receipt)); assert.equal(calls, 1);
    mode = "crossmodel"; await assert.rejects(client.uploadWan26R2vSelectedVideo(fx.receipt)); assert.equal(calls, 2);
    mode = "http"; await assert.rejects(client.uploadWan26R2vSelectedVideo(fx.receipt), (e: unknown) => e instanceof SyntxHttpError); assert.equal(calls, 3);
    mode = "abort"; const controller = new AbortController(), pending = client.uploadWan26R2vSelectedVideo(fx.receipt, controller.signal);
    setTimeout(() => controller.abort(), 10); await assert.rejects(pending); assert.equal(calls, 4);
    mode = "release"; const fetchStarted = new Promise<void>((resolve) => { announceFetch = resolve; });
    const stale = client.uploadWan26R2vSelectedVideo(fx.receipt); await fetchStarted;
    releaseTrustedOwnerWan26R2vVideoCropReceipt(fx.receipt); cropLive = false;
    releaseFetch?.(); await assert.rejects(stale); assert.equal(calls, 5);
    await assert.rejects(client.uploadWan26R2vSelectedVideo(fx.receipt)); assert.equal(calls, 5);
  } finally { if (cropLive) releaseTrustedOwnerWan26R2vVideoCropReceipt(fx.receipt); releaseTrustedOwnerWan26R2vOriginalProbeResult(fx.original); await rm(fx.root, { recursive: true, force: true }); }
});
