import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateOwnerWan27R2vImage, releaseValidatedOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import {
  createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult
} from "../src/application/owner-wan27-r2v-original-probe.js";
import {
  createOwnerWan27R2vVideoCropProcessor, copyTrustedOwnerWan27R2vVideoCropBytes,
  isTrustedOwnerWan27R2vVideoCropReceipt, releaseTrustedOwnerWan27R2vVideoCropReceipt
} from "../src/application/owner-wan27-r2v-video-crop.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  readOwnerWan27R2vUploadReferenceForClient
} from "../src/adapter/syntx/wan27-r2v-upload-context.js";

const exec = promisify(execFile);
const MEDIA_TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const SECRET = "wan27-upload-fixture-credential";
const VIDEO_URL = "https://r2.syntx.ai/hidden/wan27-selected.mp4";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x16,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x20,10,0,0,0,0,0,0,0x9d,1,0x2a,0xf0,0,0xf0,0]);

function broker(onUse: () => void = () => undefined): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { onUse(); return operation(SECRET); } };
}
function json(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
function crc32(bytes: Uint8Array): number { let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); } return (crc ^ 0xffff_ffff) >>> 0; }
function png240(): Buffer { const bytes = Buffer.from(PNG); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes; }
function jpeg240(): Buffer { return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,0,240,0,240,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]); }
function bmp240(): Buffer { const stride = 720, pixels = stride * 240, bytes = Buffer.alloc(54 + pixels); bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(240, 18); bytes.writeInt32LE(240, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(pixels, 34); return bytes; }
const IMAGE_CASES = [
  { bytes: jpeg240(), filename: "frame.jpg", mime: "image/jpeg" },
  { bytes: png240(), filename: "frame.png", mime: "image/png" },
  { bytes: bmp240(), filename: "frame.bmp", mime: "image/bmp" },
  { bytes: WEBP, filename: "frame.webp", mime: "image/webp" }
] as const;

test("WAN 2.7 R2V image uploads use fixed uploaded multipart fields and return same-client metadata context", async () => {
  for (const [index, item] of IMAGE_CASES.entries()) {
    let credentials = 0, requests = 0, submittedForm: FormData | undefined, fixtureAssertionError: Error | undefined;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async (input, init) => {
      try {
        requests += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files"); assert.equal(init?.method, "POST");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`); assert.equal(init?.redirect, "error");
        assert.ok(init?.body instanceof FormData); submittedForm = init.body as FormData;
        assert.equal(submittedForm.get("destination"), "uploaded"); assert.equal(submittedForm.get("check_duplicates"), "true");
        assert.equal(submittedForm.get("model_type"), "wan_27_r2v");
        const file = submittedForm.get("files"); assert.ok(file instanceof File); assert.equal(file.name, item.filename); assert.equal(file.type, item.mime);
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(item.bytes));
        const url = `https://r2.syntx.ai/uploaded/image-${index}.bin`;
        return json({ files: [{ id: index + 1, url, filename: item.filename, mime_type: item.mime, size: item.bytes.byteLength }] });
      } catch (error) { fixtureAssertionError = error instanceof Error ? error : new Error(String(error)); throw error; }
    } });
    const image = validateOwnerWan27R2vImage({ filename: item.filename, mime_type: item.mime, bytes: item.bytes });
    try {
      let context: Awaited<ReturnType<typeof client.uploadWan27R2vImage>>;
      try { context = await client.uploadWan27R2vImage(image); }
      catch (error) { if (fixtureAssertionError) throw fixtureAssertionError; throw error; }
      releaseValidatedOwnerWan27R2vImage(image);
      assert.equal(Object.isFrozen(context), true); assert.equal(context.model_id, "wan_27_r2v"); assert.equal(context.media_type, "image");
      assert.equal(context.mime_type, item.mime); assert.equal(context.size, item.bytes.byteLength);
      assert.equal(context.sha256, createHash("sha256").update(item.bytes).digest("hex"));
      assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
      assert.deepEqual(readOwnerWan27R2vUploadReferenceForClient(client, context), { url: `https://r2.syntx.ai/uploaded/image-${index}.bin` });
      const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker() });
      assert.equal(readOwnerWan27R2vUploadReferenceForClient(foreignClient, context), null);
      assert.equal(readOwnerWan27R2vUploadReferenceForClient(client, { ...context }), null);
      assert.equal(readOwnerWan27R2vUploadReferenceForClient(client, new Proxy(context, {})), null);
      Object.defineProperty(client, "uploadWan27R2vImage", { value: () => Promise.reject(new Error("override")) });
      assert.equal(readOwnerWan27R2vUploadReferenceForClient(client, context), null);
      assert.equal(submittedForm?.get("files"), null); assert.equal(credentials, 1); assert.equal(requests, 1);
    } finally { releaseValidatedOwnerWan27R2vImage(image); }
  }
});

test("WAN 2.7 R2V selected video uploads a genuine measured crop as hidden with source-bound safe context", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const { ffmpeg, ffprobe } = MEDIA_TOOLS;
  try { await exec(ffmpeg, ["-version"]); await exec(ffprobe, ["-version"]); } catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-upload-test-")), sourcePath = join(directory, "source.mp4");
  let original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
  let crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>> | undefined;
  let measuredBytes: Uint8Array | undefined;
  try {
    await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: ffprobe }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes: sourceBytes }); sourceBytes.fill(0);
    const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: 0.25, end_seconds: 1.25, video_reference_count: 1 });
    crop = await createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: ffmpeg, ffprobePath: ffprobe }).crop(original, selection);
    measuredBytes = copyTrustedOwnerWan27R2vVideoCropBytes(crop);
    const expectedCropSha = crop.crop_sha256, expectedCropSize = crop.bytes;
    let credentials = 0, requests = 0, submittedForm: FormData | undefined;
    let durationObservation = 1.02;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async (input, init) => {
      requests += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files"); assert.equal(init?.method, "POST");
      submittedForm = init?.body as FormData;
      assert.equal(submittedForm?.get("destination"), "hidden"); assert.equal(submittedForm?.get("check_duplicates"), "true");
      assert.equal(submittedForm?.get("model_type"), "wan_27_r2v");
      const file = submittedForm?.get("files"); assert.ok(file instanceof File); assert.equal(file.type, "video/mp4");
      assert.equal(file.size, expectedCropSize); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), measuredBytes);
      return json({ files: [{ id: "crop-1528", url: VIDEO_URL, filename: "wan27-r2v-selected-video.mp4",
        content_type: "video/mp4", duration: durationObservation, size: expectedCropSize }] });
    } });
    const context = await client.uploadWan27R2vSelectedVideo(crop);
    assert.equal(context.model_id, "wan_27_r2v"); assert.equal(context.media_type, "selected_video");
    assert.equal(context.mime_type, "video/mp4"); assert.equal(context.size, expectedCropSize);
    assert.equal(context.video_duration_seconds, 1); assert.equal(context.width, original.metadata.width); assert.equal(context.height, original.metadata.height);
    assert.equal(context.source_sha256, original.source_sha256); assert.equal(context.sha256, expectedCropSha);
    assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
    assert.deepEqual(readOwnerWan27R2vUploadReferenceForClient(client, context), { url: VIDEO_URL });
    assert.equal(readOwnerWan27R2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
    assert.equal(submittedForm?.get("files"), null); assert.equal(credentials, 1); assert.equal(requests, 1);
    durationObservation = 1.1;
    await assert.rejects(client.uploadWan27R2vSelectedVideo(crop), (error: unknown) => error instanceof SyntxHttpError);
    assert.equal(credentials, 2); assert.equal(requests, 2);
    releaseTrustedOwnerWan27R2vVideoCropReceipt(crop); crop = undefined;
    assert.deepEqual(readOwnerWan27R2vUploadReferenceForClient(client, context), { url: VIDEO_URL });
  } finally {
    measuredBytes?.fill(0);
    if (crop && isTrustedOwnerWan27R2vVideoCropReceipt(crop)) releaseTrustedOwnerWan27R2vVideoCropReceipt(crop);
    if (original) releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
    await rm(directory, { recursive: true, force: true });
  }
});

test("WAN 2.7 R2V native upload rejects forged receipts before credentials and malformed acknowledgements mint no context", async () => {
  let credentials = 0, requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async () => {
    requests += 1; return json({ files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", mime_type: "image/png", size: png240().byteLength }] });
  } });
  await assert.rejects(client.uploadWan27R2vImage(Object.freeze({ model_id: "wan_27_r2v", size: 1 }) as never));
  await assert.rejects(client.uploadWan27R2vSelectedVideo(Object.freeze({ model_id: "wan_27_r2v", bytes: 10 }) as never));
  assert.equal(credentials, 0); assert.equal(requests, 0);

  const image = validateOwnerWan27R2vImage({ filename: "x.png", mime_type: "image/png", bytes: png240() });
  let responsePayload: unknown = { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", filename: "x.png", mime_type: "image/png", size: image.size }] };
  const badClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => json(responsePayload) });
  try {
    const good = await badClient.uploadWan27R2vImage(image);
    assert.deepEqual(readOwnerWan27R2vUploadReferenceForClient(badClient, good), { url: "https://r2.syntx.ai/uploaded/x.png" });
    const malformed = [
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", filename: "other.png", mime_type: "image/png", size: image.size }] },
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", filename: "x.png", mime_type: "image/jpeg", size: image.size }] },
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", filename: "x.png", mime_type: "image/png", size: image.size + 1 }] },
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", filename: "x.png", content_type: "image/jpeg", size: image.size }] },
      { files: [{ id: 1, url: "https://user@r2.syntx.ai:443/uploaded/x.png#secret", filename: "x.png", mime_type: "image/png", size: image.size }] },
      { files: [{ id: 1, file_id: 2, url: "https://r2.syntx.ai/uploaded/x.png", filename: "x.png", mime_type: "image/png", size: image.size }] },
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/x.png", filename: "x.png", mime_type: "image/png", size: image.size },
        { id: 2, url: "https://r2.syntx.ai/uploaded/y.png", filename: "x.png", mime_type: "image/png", size: image.size }] }
    ];
    for (responsePayload of malformed) {
      await assert.rejects(badClient.uploadWan27R2vImage(image), (error: unknown) => error instanceof SyntxHttpError);
    }
  } finally { releaseValidatedOwnerWan27R2vImage(image); }
});
