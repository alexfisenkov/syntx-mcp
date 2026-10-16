import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../src/adapter/syntx/upload-reference-bridge.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  isValidatedOwnerWan27VideoEditImage,
  releaseValidatedOwnerWan27VideoEditImage,
  validateOwnerWan27VideoEditImage
} from "../src/application/owner-wan27-videoedit-image-policy.js";
import {
  isValidatedOwnerWan27VideoEditVideo,
  releaseValidatedOwnerWan27VideoEditVideo,
  validateOwnerWan27VideoEditVideo,
  type ValidatedOwnerWan27VideoEditVideo
} from "../src/application/owner-wan27-videoedit-video-policy.js";

const SAFE_URL = "https://r2.syntx.ai/wan27-videoedit/source.png";
const SAFE_VIDEO_URL = "https://r2.syntx.ai/wan27-videoedit/source.mp4";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]);
const PROBE_JSON = JSON.stringify({ streams: [
  { codec_type: "video", codec_name: "mpeg4", width: 320, height: 240, start_time: "0", duration: "3", duration_ts: 3000, time_base: "1/1000" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3" } });

type WanUploadClient = SyntxChatHttpClient & {
  uploadOwnerWan27VideoEditReference(receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference>;
};
type VideoUploadReceipt = Readonly<ValidatedOwnerWan27VideoEditVideo>;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png300(): Buffer {
  const bytes = Buffer.from(PNG_1X1);
  bytes.writeUInt32BE(300, 16);
  bytes.writeUInt32BE(300, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function makeFfprobe(output = PROBE_JSON): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-videoedit-upload-ffprobe-"));
  const interpreter = join(directory, "node");
  const path = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const script = `#!${interpreter}\nconst args=process.argv.slice(2);` +
    `const i=args.indexOf("-protocol_whitelist");if(i<0||args[i+1]!=="file,pipe")process.exit(21);` +
    `require("node:fs").statSync(args[args.length-1]);process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(path, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(path, 0o700);
  return { directory, path: realpathSync(path) };
}

function makeClient(
  onFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  onCredential: () => void = () => {}
): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      onCredential();
      return operation("synthetic-wan27-videoedit-upload-credential");
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl: onFetch, requestTimeoutMs: 1_000 });
}

function upload(client: SyntxChatHttpClient, receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference> {
  const method = Reflect.get(client, "uploadOwnerWan27VideoEditReference");
  assert.equal(typeof method, "function", "the native client exposes a WAN27 Video Edit reference upload method");
  return Reflect.apply(method as WanUploadClient["uploadOwnerWan27VideoEditReference"], client, [receipt, signal]);
}

test("consumes an authentic WAN27 Video Edit image before one fixed multipart upload", async () => {
  const source = png300();
  const original = Buffer.from(source);
  const receipt = validateOwnerWan27VideoEditImage({
    model_id: "wan_27_videoedit", filename: "frame.png", mime_type: "image/png", bytes: source
  });
  let fetchCalls = 0;
  let credentialCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(isValidatedOwnerWan27VideoEditImage(receipt), false, "receipt must be released before fetch");
    retainedForm = init?.body as FormData;
    assert.deepEqual(Array.from(retainedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(retainedForm.get("destination"), "uploaded");
    assert.equal(retainedForm.get("check_duplicates"), "true");
    assert.equal(retainedForm.get("model_type"), "wan_27_videoedit");
    const file = retainedForm.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "frame.png");
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);
    return response({ files: [{ id: "wan27-videoedit-image-1", url: SAFE_URL, status: "uploaded",
      filename: "provider-renamed-frame.png", mime_type: "image/png", size: file.size }] });
  }, () => { credentialCalls += 1; });

  try {
    const result = await upload(client, receipt);
    assert.deepEqual(result, { file_id: "wan27-videoedit-image-1", url: SAFE_URL });
    assert.equal(fetchCalls, 1);
    assert.equal(credentialCalls, 1);
    assert.equal(isValidatedOwnerWan27VideoEditImage(receipt), false);
    assert.deepEqual(source, original, "upload must leave caller-owned bytes untouched");
    assert.ok(retainedForm);
    assert.equal(retainedForm.get("files"), null, "multipart file is removed after request completion");
  } finally {
    releaseValidatedOwnerWan27VideoEditImage(receipt);
  }
});

test("consumes a freshly probed WAN27 Video Edit video before one exact-model upload", async () => {
  const probe = await makeFfprobe();
  const source = Buffer.from(MP4);
  const original = Buffer.from(source);
  let receipt: VideoUploadReceipt | undefined;
  let fetchCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(isValidatedOwnerWan27VideoEditVideo(receipt), false, "video receipt must be released before fetch");
    retainedForm = init?.body as FormData;
    assert.deepEqual(Array.from(retainedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(retainedForm.get("destination"), "uploaded");
    assert.equal(retainedForm.get("check_duplicates"), "true");
    assert.equal(retainedForm.get("model_type"), "wan_27_videoedit");
    const file = retainedForm.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "source.mp4");
    assert.equal(file.type, "video/mp4");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);
    return response({ files: [{ id: "wan27-videoedit-video-1", url: SAFE_VIDEO_URL, status: "uploaded",
      filename: "provider-renamed-source.mp4", mime_type: "video/mp4", size: file.size }] });
  });
  try {
    receipt = await validateOwnerWan27VideoEditVideo({ filename: "source.mp4", mime_type: "video/mp4", bytes: source,
      ffprobePath: probe.path });
    assert.equal(receipt.duration_seconds, 3);
    assert.equal(receipt.model_id, "wan_27_videoedit");
    await assert.rejects(upload(client, Object.freeze({ ...receipt })), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(isValidatedOwnerWan27VideoEditVideo(receipt), true, "a forged copy must not consume the authentic receipt");
    const result = await upload(client, receipt);
    assert.deepEqual(result, { file_id: "wan27-videoedit-video-1", url: SAFE_VIDEO_URL });
    assert.equal(fetchCalls, 1);
    assert.equal(isValidatedOwnerWan27VideoEditVideo(receipt), false);
    assert.deepEqual(source, original, "upload must leave caller-owned bytes untouched");
    assert.ok(retainedForm);
    assert.equal(retainedForm.get("files"), null);
  } finally {
    if (receipt) releaseValidatedOwnerWan27VideoEditVideo(receipt);
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test("rejects forged or proxied WAN27 Video Edit image receipts before credential use", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const client = makeClient(async () => {
    fetchCalls += 1;
    return response({ files: [{ id: "should-not-upload", url: SAFE_URL }] });
  }, () => { credentialCalls += 1; });
  const receipt = validateOwnerWan27VideoEditImage({
    model_id: "wan_27_videoedit", filename: "frame.png", mime_type: "image/png", bytes: png300()
  });
  try {
    await assert.rejects(upload(client, Object.freeze({ ...receipt })), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(upload(client, new Proxy(receipt, {})), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(fetchCalls, 0);
    assert.equal(credentialCalls, 0);
    assert.equal(isValidatedOwnerWan27VideoEditImage(receipt), true, "a rejected copy must not consume the genuine receipt");
  } finally {
    releaseValidatedOwnerWan27VideoEditImage(receipt);
  }
});

test("rejects malformed upload filename echoes and wipes multipart file after the single POST", async () => {
  const receipt = validateOwnerWan27VideoEditImage({
    model_id: "wan_27_videoedit", filename: "frame.png", mime_type: "image/png", bytes: png300()
  });
  let fetchCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (_input, init) => {
    fetchCalls += 1;
    retainedForm = init?.body as FormData;
    const file = retainedForm.get("files");
    assert.ok(file instanceof File);
    return response({ files: [{ id: "wan27-videoedit-bad-name", url: SAFE_URL, status: "uploaded",
      filename: "../frame.png", mime_type: "image/png", size: file.size }] });
  });
  try {
    await assert.rejects(upload(client, receipt), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
    assert.equal(fetchCalls, 1, "response validation happens after exactly one upload");
    assert.equal(isValidatedOwnerWan27VideoEditImage(receipt), false, "failed upload does not restore the receipt");
    assert.ok(retainedForm);
    assert.equal(retainedForm.get("files"), null);
  } finally {
    releaseValidatedOwnerWan27VideoEditImage(receipt);
  }
});
