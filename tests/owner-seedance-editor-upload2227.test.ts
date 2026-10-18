import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../src/adapter/syntx/upload-reference-bridge.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  isValidatedOwnerSeedanceEditorVideo,
  releaseValidatedOwnerSeedanceEditorVideo,
  validateOwnerSeedanceEditorVideo,
  type ValidatedOwnerSeedanceEditorVideo
} from "../src/application/owner-seedance-editor-video-policy.js";

const SAFE_URL = "https://r2.syntx.ai/seedance-editor/source.mp4";
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]);
const PROBE_JSON = JSON.stringify({ streams: [
  { codec_type: "video", codec_name: "mpeg4", width: 320, height: 240, start_time: "0", duration: "4.25",
    duration_ts: 4250, time_base: "1/1000" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "4.25" } });

type EditorUploadClient = SyntxChatHttpClient & {
  uploadOwnerSeedanceEditorVideo(receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference>;
};
type VideoReceipt = Readonly<ValidatedOwnerSeedanceEditorVideo>;

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function makeFfprobe(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-seedance-editor-upload-ffprobe-"));
  const interpreter = join(directory, "node");
  const path = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const script = `#!${interpreter}\nconst args=process.argv.slice(2);` +
    `const i=args.indexOf("-protocol_whitelist");if(i<0||args[i+1]!=="file,pipe")process.exit(21);` +
    `require("node:fs").statSync(args[args.length-1]);process.stdout.write(${JSON.stringify(PROBE_JSON)});\n`;
  await writeFile(path, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(path, 0o700);
  return { directory, path: realpathSync(path) };
}

function makeClient(onFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  onCredential: () => void = () => {}): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      onCredential();
      return operation("synthetic-seedance-editor-upload-credential");
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl: onFetch, requestTimeoutMs: 1_000 });
}

function upload(client: SyntxChatHttpClient, receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference> {
  const method = Reflect.get(client, "uploadOwnerSeedanceEditorVideo");
  assert.equal(typeof method, "function", "the native client exposes a Seedance Editor video upload method");
  return Reflect.apply(method as EditorUploadClient["uploadOwnerSeedanceEditorVideo"], client, [receipt, signal]);
}

test("consumes a trusted Seedance Editor receipt in one model-bound multipart upload", async () => {
  const probe = await makeFfprobe();
  const source = Buffer.from(MP4);
  const original = Buffer.from(source);
  let receipt: VideoReceipt | undefined;
  let fetchCalls = 0;
  let credentialCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(isValidatedOwnerSeedanceEditorVideo(receipt), false, "the private receipt is consumed before fetch");
    retainedForm = init?.body as FormData;
    assert.deepEqual(Array.from(retainedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(retainedForm.get("destination"), "uploaded");
    assert.equal(retainedForm.get("check_duplicates"), "true");
    assert.equal(retainedForm.get("model_type"), "seedance-2.5");
    const file = retainedForm.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "source.mp4");
    assert.equal(file.type, "video/mp4");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);
    return response({ files: [{ id: "seedance-editor-video-1", url: SAFE_URL, status: "uploaded",
      filename: "source.mp4", mime_type: "video/mp4", size: file.size }] });
  }, () => { credentialCalls += 1; });

  try {
    receipt = await validateOwnerSeedanceEditorVideo({ filename: "source.mp4", mime_type: "video/mp4", bytes: source,
      ffprobePath: probe.path });
    const result = await upload(client, receipt);
    assert.deepEqual(result, { file_id: "seedance-editor-video-1", url: SAFE_URL });
    assert.equal(fetchCalls, 1);
    assert.equal(credentialCalls, 1);
    assert.equal(isValidatedOwnerSeedanceEditorVideo(receipt), false);
    assert.deepEqual(source, original, "upload leaves caller-owned bytes untouched");
    assert.ok(retainedForm);
    assert.equal(retainedForm.get("files"), null, "multipart file is removed after the request");
  } finally {
    if (receipt) releaseValidatedOwnerSeedanceEditorVideo(receipt);
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test("rejects cloned and proxied Seedance Editor receipts before credentials or fetch", async () => {
  const probe = await makeFfprobe();
  let receipt: VideoReceipt | undefined;
  let fetchCalls = 0;
  let credentialCalls = 0;
  const client = makeClient(async () => {
    fetchCalls += 1;
    return response({ files: [{ id: "should-not-upload", url: SAFE_URL }] });
  }, () => { credentialCalls += 1; });
  try {
    receipt = await validateOwnerSeedanceEditorVideo({ filename: "source.mp4", mime_type: "video/mp4", bytes: MP4,
      ffprobePath: probe.path });
    await assert.rejects(upload(client, Object.freeze({ ...receipt })), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(upload(client, new Proxy(receipt, {})), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(fetchCalls, 0);
    assert.equal(credentialCalls, 0);
    assert.equal(isValidatedOwnerSeedanceEditorVideo(receipt), true, "rejected copies do not consume the genuine receipt");
  } finally {
    if (receipt) releaseValidatedOwnerSeedanceEditorVideo(receipt);
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test("rejects malformed upload references after exactly one POST and wipes the form", async () => {
  const probe = await makeFfprobe();
  let receipt: VideoReceipt | undefined;
  let fetchCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (_input, init) => {
    fetchCalls += 1;
    retainedForm = init?.body as FormData;
    return response({ files: [
      { id: "seedance-editor-video-bad", url: SAFE_URL, filename: "../source.mp4", mime_type: "video/mp4", size: MP4.length },
      { id: "unexpected-extra", url: "https://r2.syntx.ai/seedance-editor/extra.mp4" }
    ] });
  });
  try {
    receipt = await validateOwnerSeedanceEditorVideo({ filename: "source.mp4", mime_type: "video/mp4", bytes: MP4,
      ffprobePath: probe.path });
    await assert.rejects(upload(client, receipt), (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
      assert.equal(error.message.includes(SAFE_URL), false, "rejected upload URLs do not leak through errors");
      return true;
    });
    assert.equal(fetchCalls, 1, "malformed response is not retried");
    assert.ok(retainedForm);
    assert.equal(retainedForm.get("files"), null);
  } finally {
    if (receipt) releaseValidatedOwnerSeedanceEditorVideo(receipt);
    await rm(probe.directory, { recursive: true, force: true });
  }
});

test("wipes bytes and multipart body when the single upload request fails", async () => {
  const probe = await makeFfprobe();
  let receipt: VideoReceipt | undefined;
  let fetchCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (_input, init) => {
    fetchCalls += 1;
    retainedForm = init?.body as FormData;
    throw new Error("synthetic upload transport failure");
  });
  try {
    receipt = await validateOwnerSeedanceEditorVideo({ filename: "source.mp4", mime_type: "video/mp4", bytes: MP4,
      ffprobePath: probe.path });
    await assert.rejects(upload(client, receipt));
    assert.equal(fetchCalls, 1, "transport failure is not retried");
    assert.equal(isValidatedOwnerSeedanceEditorVideo(receipt), false);
    assert.ok(retainedForm);
    assert.equal(retainedForm.get("files"), null);
  } finally {
    if (receipt) releaseValidatedOwnerSeedanceEditorVideo(receipt);
    await rm(probe.directory, { recursive: true, force: true });
  }
});
