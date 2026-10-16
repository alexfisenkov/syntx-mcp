import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../src/adapter/syntx/upload-reference-bridge.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  isValidatedOwnerKling4Image,
  readValidatedOwnerKling4Image,
  releaseValidatedOwnerKling4Image,
  validateOwnerKling4Image,
  type OwnerKling4ModelId
} from "../src/application/owner-kling4-image-policy.js";
import {
  isValidatedOwnerKling4OmniVideo,
  readValidatedOwnerKling4OmniVideo,
  releaseValidatedOwnerKling4OmniVideo,
  validateOwnerKling4OmniVideo,
  type ValidatedOwnerKling4OmniVideo
} from "../src/application/owner-kling4-omni-video-policy.js";

const SAFE_URL = "https://r2.syntx.ai/kling4/source.bin";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const MP4 = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const MODEL_IDS: readonly OwnerKling4ModelId[] = ["kling_4_keyframes", "kling_4_omni"];
const FORMAT_NAME = "mov,mp4,m4a,3gp,3g2,mj2";

type UploadClient = SyntxChatHttpClient & {
  uploadOwnerKling4Reference(receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference>;
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png300(): Buffer {
  const bytes = Buffer.from(PNG);
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeClient(
  onFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  onCredential: () => void = () => {}
): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      onCredential();
      return operation("synthetic-kling4-upload-credential");
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl: onFetch, requestTimeoutMs: 1_000 });
}

function upload(client: SyntxChatHttpClient, receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference> {
  const method = Reflect.get(client, "uploadOwnerKling4Reference");
  assert.equal(typeof method, "function", "the native client exposes the one-shot K4 reference upload method");
  return Reflect.apply(method as UploadClient["uploadOwnerKling4Reference"], client, [receipt, signal]);
}

async function makeFfprobe(output: string): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-kling4-upload-ffprobe-"));
  const interpreter = join(directory, "node");
  const path = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const script = `#!/${interpreter}\nconst args=process.argv.slice(2);\n` +
    `const i=args.indexOf("-protocol_whitelist");if(i<0||args[i+1]!=="file,pipe")process.exit(21);\n` +
    `require("node:fs").statSync(args[args.length-1]);\n` +
    `process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(path, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(path, 0o700);
  return { directory, path };
}

async function genuineVideoReceipt(ffprobePath: string): Promise<Readonly<ValidatedOwnerKling4OmniVideo>> {
  return validateOwnerKling4OmniVideo({ filename: "source.mp4", mime_type: "video/mp4", bytes: MP4, ffprobePath });
}

test("uploads PNG receipts for each K4 ID with one fixed tuple and consumes before fetch", async () => {
  for (const modelId of MODEL_IDS) {
    const source = png300();
    const original = Buffer.from(source);
    const receipt = validateOwnerKling4Image({ model_id: modelId, filename: "кадр.bin", mime_type: "image/png", bytes: source });
    let fetchCalls = 0, credentialCalls = 0;
    let retainedForm: FormData | undefined;
    const client = makeClient(async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
      assert.equal(isValidatedOwnerKling4Image(receipt, modelId), false, "receipt must be revoked before the first await");
      retainedForm = init?.body as FormData;
      assert.deepEqual(Array.from(retainedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(retainedForm.get("destination"), "uploaded");
      assert.equal(retainedForm.get("check_duplicates"), "true");
      assert.equal(retainedForm.get("model_type"), modelId);
      const file = retainedForm.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "кадр.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);
      return response({ files: [{ id: `k4-${modelId}-image-1`, url: SAFE_URL, status: "uploaded",
        filename: file.name, mime_type: file.type, size: file.size }] });
    }, () => { credentialCalls += 1; });

    try {
      const result = await upload(client, receipt);
      assert.deepEqual(result, { file_id: `k4-${modelId}-image-1`, url: SAFE_URL });
      assert.equal(fetchCalls, 1); assert.equal(credentialCalls, 1);
      assert.equal(isValidatedOwnerKling4Image(receipt, modelId), false);
      assert.equal(readValidatedOwnerKling4Image(receipt, modelId), null);
      assert.deepEqual(source, original, "upload must not mutate caller-owned bytes");
      assert.ok(retainedForm); assert.equal(retainedForm.get("files"), null);
    } finally { releaseValidatedOwnerKling4Image(receipt); }
  }
});

test("uploads the verified Omni video snapshot without depending on its cost-duration field", async () => {
  const fake = await makeFfprobe(JSON.stringify({ streams: [
    { codec_type: "video", codec_name: "h264", width: 700, height: 700, start_time: "0.000000", duration: "4.000000" },
    { codec_type: "audio", codec_name: "aac", start_time: "30.000000", duration: "10.000000" }
  ], format: { format_name: FORMAT_NAME, duration: "4.000000" } }));
  const receipt = await genuineVideoReceipt(fake.path);
  let fetchCalls = 0, credentialCalls = 0;
  let retainedForm: FormData | undefined;
  const client = makeClient(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(isValidatedOwnerKling4OmniVideo(receipt), false, "video receipt must be revoked before the first await");
    retainedForm = init?.body as FormData;
    assert.deepEqual(Array.from(retainedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(retainedForm.get("destination"), "uploaded");
    assert.equal(retainedForm.get("check_duplicates"), "true");
    assert.equal(retainedForm.get("model_type"), "kling_4_omni");
    const file = retainedForm.get("files"); assert.ok(file instanceof File);
    assert.equal(file.name, "source.mp4"); assert.equal(file.type, "video/mp4");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), MP4);
    return response({ files: [{ file_id: "k4-video-1", url: SAFE_URL, filename: file.name, mime_type: file.type, size: file.size }] });
  }, () => { credentialCalls += 1; });
  try {
    assert.equal(receipt.metadata.duration_seconds, 4);
    assert.equal(receipt.metadata.input_cost_duration_seconds, 40);
    const result = await upload(client, receipt);
    assert.deepEqual(result, { file_id: "k4-video-1", url: SAFE_URL });
    assert.equal(fetchCalls, 1); assert.equal(credentialCalls, 1);
    assert.equal(readValidatedOwnerKling4OmniVideo(receipt), null);
    assert.ok(retainedForm); assert.equal(retainedForm.get("files"), null);
  } finally {
    releaseValidatedOwnerKling4OmniVideo(receipt);
    await rm(fake.directory, { recursive: true, force: true });
  }
});

test("rejects forged, proxied and already-released receipts before credentials or HTTP", async () => {
  let fetchCalls = 0, credentialCalls = 0;
  const client = makeClient(async () => { fetchCalls += 1; return response({ files: [{ url: SAFE_URL }] }); },
    () => { credentialCalls += 1; });
  const image = validateOwnerKling4Image({ model_id: "kling_4_keyframes", filename: "frame.png", mime_type: "image/png", bytes: png300() });
  const videoProbe = await makeFfprobe(JSON.stringify({ streams: [
    { codec_type: "video", codec_name: "h264", width: 700, height: 700, start_time: "0", duration: "4" }
  ], format: { format_name: FORMAT_NAME, duration: "4" } }));
  const video = await genuineVideoReceipt(videoProbe.path);
  try {
    await assert.rejects(upload(client, Object.freeze({ ...image })), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(upload(client, new Proxy(image, {})), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(upload(client, Object.freeze({ ...video })), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(releaseValidatedOwnerKling4Image(image), true);
    assert.equal(releaseValidatedOwnerKling4OmniVideo(video), true);
    await assert.rejects(upload(client, image), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    await assert.rejects(upload(client, video), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(fetchCalls, 0); assert.equal(credentialCalls, 0);
  } finally {
    releaseValidatedOwnerKling4Image(image); releaseValidatedOwnerKling4OmniVideo(video);
    await rm(videoProbe.directory, { recursive: true, force: true });
  }
});

test("rejects unsafe, multiple and mismatched upload response files after one POST", async (t) => {
  const invalidResponses: readonly unknown[] = [
    {}, { files: [] }, { files: [{ url: SAFE_URL }, { url: "https://r2.syntx.ai/other.bin" }] },
    { files: [{ url: "https://attacker.invalid/private.bin" }] },
    { files: [{ url: SAFE_URL, mime_type: "image/jpeg" }] },
    { files: [{ url: SAFE_URL, size: 1 }] },
    { files: [{ url: SAFE_URL, status: "error" }] },
    { files: [{ id: "one", file_id: "two", url: SAFE_URL }] }
  ];
  for (const [index, body] of invalidResponses.entries()) await t.test(`response ${index + 1}`, async () => {
    const receipt = validateOwnerKling4Image({ model_id: "kling_4_omni", filename: "frame.png", mime_type: "image/png", bytes: png300() });
    let fetchCalls = 0, form: FormData | undefined;
    const client = makeClient(async (_input, init) => { fetchCalls += 1; form = init?.body as FormData; return response(body); });
    try {
      await assert.rejects(upload(client, receipt), (error: unknown) => error instanceof SyntxHttpError &&
        error.code === "UPSTREAM_PROTOCOL_ERROR" && !error.message.includes("attacker.invalid") && !error.message.includes("private.bin"));
      assert.equal(fetchCalls, 1);
      assert.equal(isValidatedOwnerKling4Image(receipt, "kling_4_omni"), false);
      assert.ok(form); assert.equal(form.get("files"), null);
    } finally { releaseValidatedOwnerKling4Image(receipt); }
  });
});

test("HTTP and abort failures consume one receipt, release FormData and never retry", async () => {
  const httpReceipt = validateOwnerKling4Image({ model_id: "kling_4_keyframes", filename: "frame.png", mime_type: "image/png", bytes: png300() });
  let httpCalls = 0, httpForm: FormData | undefined;
  const httpClient = makeClient(async (_input, init) => { httpCalls += 1; httpForm = init?.body as FormData; return response({}, 503); });
  await assert.rejects(upload(httpClient, httpReceipt), (error: unknown) => error instanceof SyntxHttpError);
  assert.equal(httpCalls, 1); assert.equal(isValidatedOwnerKling4Image(httpReceipt, "kling_4_keyframes"), false);
  assert.ok(httpForm); assert.equal(httpForm.get("files"), null);

  const abortReceipt = validateOwnerKling4Image({ model_id: "kling_4_omni", filename: "frame.png", mime_type: "image/png", bytes: png300() });
  let startFetch!: () => void, abortCalls = 0, abortForm: FormData | undefined;
  const fetchStarted = new Promise<void>((resolve) => { startFetch = resolve; });
  const abortClient = makeClient(async (_input, init) => {
    abortCalls += 1; abortForm = init?.body as FormData; startFetch();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const controller = new AbortController();
  const pending = upload(abortClient, abortReceipt, controller.signal);
  await fetchStarted; controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortCalls, 1); assert.equal(isValidatedOwnerKling4Image(abortReceipt, "kling_4_omni"), false);
  assert.ok(abortForm); assert.equal(abortForm.get("files"), null);
  releaseValidatedOwnerKling4Image(httpReceipt); releaseValidatedOwnerKling4Image(abortReceipt);
});
