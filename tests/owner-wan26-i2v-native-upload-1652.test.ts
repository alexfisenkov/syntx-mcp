import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  releaseValidatedOwnerWan26I2vImage,
  validateOwnerWan26I2vImage
} from "../src/application/owner-wan26-i2v-image-policy.js";
import {
  copyTrustedOwnerWan26I2vAudioBytes,
  createOwnerWan26I2vAudioProbe,
  releaseTrustedOwnerWan26I2vAudioProbeResult
} from "../src/application/owner-wan26-i2v-audio-probe.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { readOwnerWan26I2vUploadReferenceForClient } from "../src/adapter/syntx/wan26-i2v-upload-context.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const exec = promisify(execFile);
const MEDIA = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const SECRET = "wan26-native-upload-test-credential";
const MODEL_IDS = ["wan_26_i2v", "wan_26_i2v_flash"] as const;
const BASE64_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function broker(onUse: () => void = () => undefined): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { onUse(); return operation(SECRET); } };
}
function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(BASE64_PNG); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}

test("WAN 2.6 I2V uploads actual image receipts for both model IDs with private same-client references", async () => {
  for (const [index, model_id] of MODEL_IDS.entries()) {
    const bytes = png384(), filename = `frame-${index}.png`, mime_type = "image/png" as const;
    const receipt = validateOwnerWan26I2vImage({ model_id, filename, mime_type, bytes });
    let credentials = 0, requests = 0, fixtureAssertionError: Error | undefined;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async (input, init) => {
      try {
        requests += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files"); assert.equal(init?.method, "POST");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`); assert.equal(init?.redirect, "error");
        assert.ok(init?.body instanceof FormData); const form = init.body as FormData;
        assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true"); assert.equal(form.get("model_type"), model_id);
        const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.name, filename); assert.equal(file.type, mime_type);
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
        return json({ files: [{ id: index + 1, url: `https://r2.syntx.ai/uploaded/wan26-image-${index}.png`,
          filename, mime_type, content_type: mime_type, media_type: "image", type: "image", size: bytes.byteLength, status: "uploaded" }] });
      } catch (error) { fixtureAssertionError = error instanceof Error ? error : new Error(String(error)); throw error; }
    } });
    try {
      let context: Awaited<ReturnType<typeof client.uploadWan26I2vImage>>;
      try { context = await client.uploadWan26I2vImage(receipt); }
      catch (error) { if (fixtureAssertionError) throw fixtureAssertionError; throw error; }
      assert.equal(Object.isFrozen(context), true); assert.equal(context.model_id, model_id); assert.equal(context.media_type, "image");
      assert.equal(context.mime_type, mime_type); assert.equal(context.size, bytes.byteLength);
      assert.equal(context.sha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
      assert.deepEqual(readOwnerWan26I2vUploadReferenceForClient(client, context), { url: `https://r2.syntx.ai/uploaded/wan26-image-${index}.png` });
      assert.equal(readOwnerWan26I2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
      assert.equal(readOwnerWan26I2vUploadReferenceForClient(client, { ...context }), null);
      assert.equal(readOwnerWan26I2vUploadReferenceForClient(client, new Proxy(context, {})), null);
      releaseValidatedOwnerWan26I2vImage(receipt);
      assert.deepEqual(readOwnerWan26I2vUploadReferenceForClient(client, context), { url: `https://r2.syntx.ai/uploaded/wan26-image-${index}.png` });
      Object.defineProperty(client, "uploadWan26I2vAudio", { value: () => Promise.reject(new Error("override")) });
      assert.equal(readOwnerWan26I2vUploadReferenceForClient(client, context), null);
      assert.equal(credentials, 1); assert.equal(requests, 1);
    } finally { releaseValidatedOwnerWan26I2vImage(receipt); }
  }
});

test("WAN 2.6 I2V uploads genuine ffprobe-measured MP3/WAV receipts for both model IDs", async (t) => {
  if (!MEDIA) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await exec(MEDIA.ffmpeg, ["-version"]); await exec(MEDIA.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-upload-test-"));
  const mp3Path = join(directory, "tone.mp3"), wavPath = join(directory, "tone.wav");
  try {
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", mp3Path]);
    await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=3.4",
      "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le", wavPath]);
    const probe = createOwnerWan26I2vAudioProbe({ ffprobePath: MEDIA.ffprobe });
    let index = 0;
    for (const model_id of MODEL_IDS) {
      for (const fixture of [
        { path: mp3Path, filename: "tone.mp3", mime_type: "audio/mp3" as const, canonical: "audio/mpeg" as const },
        { path: wavPath, filename: "tone.wav", mime_type: "audio/wav" as const, canonical: "audio/wav" as const }
      ]) {
        const source = new Uint8Array(await readFile(fixture.path));
        const receipt = await probe.probe({ model_id, filename: fixture.filename, mime_type: fixture.mime_type, bytes: source });
        const byteSnapshot = copyTrustedOwnerWan26I2vAudioBytes(receipt);
        let receiptReleased = false;
        let credentials = 0, requests = 0;
        const url = `https://r2.syntx.ai/uploaded/wan26-audio-${index++}.${fixture.filename.endsWith("mp3") ? "mp3" : "wav"}`;
        const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async (input, init) => {
          requests += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files"); assert.equal(init?.method, "POST");
          const form = init?.body; assert.ok(form instanceof FormData);
          assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true"); assert.equal(form.get("model_type"), model_id);
          const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.name, fixture.filename); assert.equal(file.type, fixture.canonical);
          assert.deepEqual(new Uint8Array(await file.arrayBuffer()), byteSnapshot);
          return json({ files: [{ id: index, url, filename: fixture.filename, mime_type: fixture.canonical,
            content_type: fixture.canonical, media_type: "audio", type: "audio", size: byteSnapshot.byteLength, status: "uploaded" }] });
        } });
        try {
          const context = await client.uploadWan26I2vAudio(receipt);
          assert.equal(Object.isFrozen(context), true); assert.equal(context.model_id, model_id); assert.equal(context.media_type, "audio");
          assert.equal(context.mime_type, fixture.canonical); assert.equal(context.size, byteSnapshot.byteLength);
          assert.equal(context.sha256, createHash("sha256").update(byteSnapshot).digest("hex"));
          assert.equal(context.measured_duration_seconds, receipt.metadata.duration_seconds);
          assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
          assert.deepEqual(readOwnerWan26I2vUploadReferenceForClient(client, context), { url });
          assert.equal(readOwnerWan26I2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
          const retainedReceiptBytes = copyTrustedOwnerWan26I2vAudioBytes(receipt);
          assert.deepEqual(retainedReceiptBytes, byteSnapshot); retainedReceiptBytes.fill(0);
          releaseTrustedOwnerWan26I2vAudioProbeResult(receipt); receiptReleased = true;
          assert.deepEqual(readOwnerWan26I2vUploadReferenceForClient(client, context), { url });
          assert.equal(credentials, 1); assert.equal(requests, 1);
        } finally {
          source.fill(0); byteSnapshot.fill(0); if (!receiptReleased) releaseTrustedOwnerWan26I2vAudioProbeResult(receipt);
        }
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("WAN 2.6 I2V upload rejects forged receipts and bad or ambiguous acknowledgements without minting URL contexts", async () => {
  let credentials = 0, requests = 0;
  let response: unknown = { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/good.png" }] };
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async () => {
    requests += 1; return json(response);
  } });
  await assert.rejects(client.uploadWan26I2vImage(Object.freeze({ model_id: "wan_26_i2v", size: 1 }) as never));
  await assert.rejects(client.uploadWan26I2vAudio(Object.freeze({ model_id: "wan_26_i2v", bytes_copied: 1 }) as never));
  assert.equal(credentials, 0); assert.equal(requests, 0);

  const receipt = validateOwnerWan26I2vImage({ model_id: "wan_26_i2v", filename: "frame.png", mime_type: "image/png", bytes: png384() });
  try {
    const context = await client.uploadWan26I2vImage(receipt);
    assert.equal(readOwnerWan26I2vUploadReferenceForClient(client, context)?.url, "https://r2.syntx.ai/uploaded/good.png");
    for (response of [
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/bad.png", filename: "frame.png", mime_type: "image/jpeg", size: receipt.size }] },
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/bad.png", filename: "frame.png", mime_type: "image/png", type: "audio", size: receipt.size }] },
      { files: [{ id: 1, url: "https://r2.syntx.ai/uploaded/a.png", filename: "frame.png", mime_type: "image/png", size: receipt.size },
        { id: 2, url: "https://r2.syntx.ai/uploaded/b.png", filename: "frame.png", mime_type: "image/png", size: receipt.size }] }
    ]) await assert.rejects(client.uploadWan26I2vImage(receipt), (error: unknown) => error instanceof SyntxHttpError);
    assert.deepEqual(readOwnerWan26I2vUploadReferenceForClient(client, context), { url: "https://r2.syntx.ai/uploaded/good.png" });
    assert.equal(credentials, 4); assert.equal(requests, 4);
  } finally { releaseValidatedOwnerWan26I2vImage(receipt); }
});
