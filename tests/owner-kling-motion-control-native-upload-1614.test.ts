import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readOwnerKlingMotionControlUploadReferenceForClient,
  SyntxChatHttpClient
} from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  releaseValidatedOwnerKlingMotionControlImage,
  validateOwnerKlingMotionControlImage
} from "../src/application/owner-kling-motion-control-image-policy.js";
import {
  createOwnerKlingMotionControlVideoProbe,
  releaseTrustedOwnerKlingMotionControlVideoProbeResult
} from "../src/application/owner-kling-motion-control-video-probe.js";
import {
  releaseValidatedOwnerKlingKeyframesImage,
  validateOwnerKlingKeyframesImage
} from "../src/application/owner-kling-keyframes-image-policy.js";

const SAFE_IMAGE_URL = "https://r2.syntx.ai/mcv/image.png";
const SAFE_VIDEO_URL = "https://r2.syntx.ai/mcv/video.mp4";
const FFMPEG = process.env.SYNTX_MCV_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_MCV_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
let directory: string | undefined;
let fetchCallbackError: unknown;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png300(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function client(onFetch: (url: URL, init: RequestInit | undefined) => Promise<Response>): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-test-credential");
  } };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (url, init) => {
    try { return await onFetch(new URL(typeof url === "string" || url instanceof URL ? url : url.url), init); }
    catch (error) { fetchCallbackError = error; throw error; }
  }, requestTimeoutMs: 1_000 });
}

function response(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }

test("performs actual fixed multipart uploads for genuine MCV image and video receipts", async () => {
  directory = await mkdtemp(join(tmpdir(), "syntx-mcv-upload-1614-"));
  const videoPath = join(directory, "motion source.mp4");
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x320:r=24:d=3.2",
    "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", "-y", videoPath]);
  const videoBytes = await readFile(videoPath);
  const imageBytes = png300();
  const imageOriginal = Buffer.from(imageBytes), videoOriginal = Buffer.from(videoBytes);
  const image = validateOwnerKlingMotionControlImage({ filename: "motion.png", mime_type: "image/png", bytes: imageBytes });
  const video = await createOwnerKlingMotionControlVideoProbe({ ffprobePath: FFPROBE }).probe({ filename: "motion source.mp4", mime_type: "video/mp4", bytes: videoBytes });
  const expected = [
    { filename: "motion.png", mime: "image/png", bytes: imageOriginal, url: SAFE_IMAGE_URL },
    { filename: "motion source.mp4", mime: "video/mp4", bytes: videoOriginal, url: SAFE_VIDEO_URL }
  ];
  let posts = 0;
  const native = client(async (url, init) => {
    posts += 1;
    assert.equal(url.pathname, "/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    const source = expected[posts - 1];
    assert.ok(source);
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, source.filename);
    assert.equal(file.type, source.mime);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), source.bytes);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "kling_motion_control");
    assert.equal([...form.keys()].sort().join(","), "check_duplicates,destination,files,model_type");
    return response({ files: [{ filename: file.name, url: source.url, mime_type: file.type, size: file.size }] });
  });
  try {
    let imageContext;
    try { imageContext = await native.uploadKlingMotionControlImage(image); }
    catch (error) { if (fetchCallbackError) throw fetchCallbackError; throw error; }
    const videoContext = await native.uploadKlingMotionControlVideo(video);
    assert.equal(posts, 2);
    assert.equal(imageContext.model_id, "kling_motion_control");
    assert.equal(imageContext.media_type, "image");
    assert.equal(imageContext.sha256, createHash("sha256").update(imageOriginal).digest("hex"));
    assert.equal(videoContext.model_id, "kling_motion_control");
    assert.equal(videoContext.media_type, "video");
    assert.equal(videoContext.sha256, createHash("sha256").update(videoOriginal).digest("hex"));
    assert.deepEqual(readOwnerKlingMotionControlUploadReferenceForClient(native, imageContext), { url: SAFE_IMAGE_URL });
    assert.deepEqual(readOwnerKlingMotionControlUploadReferenceForClient(native, videoContext), { url: SAFE_VIDEO_URL });
    assert.equal(readOwnerKlingMotionControlUploadReferenceForClient(client(async () => response({ files: [] })), imageContext), null);
    assert.equal(readOwnerKlingMotionControlUploadReferenceForClient(native, Object.freeze({ ...imageContext })), null);
    assert.equal(JSON.stringify(imageContext).includes(SAFE_IMAGE_URL), false);
    assert.equal(JSON.stringify(videoContext).includes(SAFE_VIDEO_URL), false);
    assert.deepEqual(imageBytes, imageOriginal);
    assert.deepEqual(videoBytes, videoOriginal);
  } finally {
    releaseValidatedOwnerKlingMotionControlImage(image);
    releaseTrustedOwnerKlingMotionControlVideoProbeResult(video);
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
  assert.ifError(fetchCallbackError);
});

test("rejects mismatched or unsafe MCV upload acknowledgements without retry", async () => {
  const image = validateOwnerKlingMotionControlImage({ filename: "motion.png", mime_type: "image/png", bytes: png300() });
  const cases: readonly unknown[] = [
    { files: [{ filename: "other.png", url: SAFE_IMAGE_URL, mime_type: "image/png", size: image.size }] },
    { files: [{ filename: "motion.png", url: SAFE_IMAGE_URL, mime_type: "video/mp4", size: image.size }] },
    { files: [{ filename: "motion.png", url: "https://example.invalid/file.png", mime_type: "image/png", size: image.size }] },
    { files: [{ filename: "motion.png", url: SAFE_IMAGE_URL, mime_type: "image/png", size: image.size },
      { filename: "motion.png", url: SAFE_VIDEO_URL, mime_type: "image/png", size: image.size }] }
  ];
  try {
    for (const invalidReceipt of cases) {
      let posts = 0;
      const native = client(async () => { posts += 1; return response(invalidReceipt); });
      const receipt = validateOwnerKlingMotionControlImage({ filename: "motion.png", mime_type: "image/png", bytes: png300() });
      await assert.rejects(native.uploadKlingMotionControlImage(receipt));
      assert.equal(posts, 1);
    }
    let posts = 0;
    const native = client(async () => { posts += 1; return response({ files: [] }); });
    const otherModelReceipt = validateOwnerKlingKeyframesImage({ filename: "frame.png", mime_type: "image/png", bytes: png300() });
    await assert.rejects(native.uploadKlingMotionControlImage(otherModelReceipt as unknown as Parameters<SyntxChatHttpClient["uploadKlingMotionControlImage"]>[0]));
    releaseValidatedOwnerKlingKeyframesImage(otherModelReceipt);
    assert.equal(posts, 0);

    const genuine = validateOwnerKlingMotionControlImage({ filename: "motion.png", mime_type: "image/png", bytes: png300() });
    await assert.rejects(native.uploadKlingMotionControlImage(Object.freeze({ ...genuine }) as Parameters<SyntxChatHttpClient["uploadKlingMotionControlImage"]>[0]));
    assert.equal(posts, 0);
    releaseValidatedOwnerKlingMotionControlImage(genuine);

    const released = validateOwnerKlingMotionControlImage({ filename: "motion.png", mime_type: "image/png", bytes: png300() });
    releaseValidatedOwnerKlingMotionControlImage(released);
    await assert.rejects(native.uploadKlingMotionControlImage(released));
    assert.equal(posts, 0);
  } finally { releaseValidatedOwnerKlingMotionControlImage(image); }
});

test("aborted MCV upload makes one POST and does not retry", async () => {
  const controller = new AbortController();
  const receipt = validateOwnerKlingMotionControlImage({ filename: "motion.png", mime_type: "image/png", bytes: png300() });
  let posts = 0;
  const native = client(async (_url, init) => {
    posts += 1;
    const signal = init?.signal;
    assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      setImmediate(() => controller.abort());
    });
  });
  await assert.rejects(native.uploadKlingMotionControlImage(receipt, controller.signal));
  assert.equal(posts, 1);
});
