import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateOwnerFlux3I2vImage, readOwnerFlux3I2vImageBytes, releaseOwnerFlux3I2vImage } from "../src/application/owner-flux3-i2v-image-probe.js";
import { isOwnerFlux3V2vOriginalProbe, probeOwnerFlux3V2vOriginal, readOwnerFlux3V2vOriginalProbeBytes,
  releaseOwnerFlux3V2vOriginalProbe } from "../src/application/owner-flux3-v2v-original-probe.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);
const IMAGE_URL = "https://r2.syntx.ai/flux3-i2v/uploaded/image.png";
const VIDEO_URL = "https://r2.syntx.ai/flux3-v2v/hidden/original.mp4";
const CREDENTIAL = "synthetic-flux3-upload-credential";
const VIDEO_FFPROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "synthetic_unlisted_codec", width: 7680, height: 4320, duration: "240.5", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "synthetic_audio" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "240.8" }
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function broker(counter: { calls: number }): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    counter.calls += 1;
    return operation(CREDENTIAL);
  } };
}

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

async function fakeFfprobe(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-v2v-upload-2010-"));
  const binary = join(directory, "ffprobe-fixture");
  const quoted = VIDEO_FFPROBE.replaceAll("'", "'\\''");
  await writeFile(binary, `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nfor last do :; done\n[ -f "$last" ] || exit 32\nprintf '%s' '${quoted}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

async function callUpload(client: SyntxChatHttpClient, name: string, ...args: unknown[]): Promise<unknown> {
  const method = Reflect.get(client, name);
  assert.equal(typeof method, "function", `SyntxChatHttpClient.${name} must exist`);
  return Reflect.apply(method as (...values: unknown[]) => Promise<unknown>, client, args);
}

test("Flux3 I2V uploads one genuine image with exact multipart binding and retains URL only for its client", async () => {
  const source = new Uint8Array(IMAGE_PNG);
  const probe = validateOwnerFlux3I2vImage({ model_id: "flux3_i2v", filename: "scene.png", mime_type: "image/png", bytes: source });
  const network = { calls: 0 };
  const credentials = { calls: 0 };
  let submitted: FormData | undefined;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(credentials),
    fetchImpl: async (input, init) => {
      network.calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      const form = init?.body as FormData;
      submitted = form;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "flux3_i2v");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "scene.png");
      assert.equal(file.type, "image/png");
      assert.equal(file.size, source.byteLength);
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
      return jsonResponse({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success",
        size: source.byteLength, content_type: "image/png" }] });
    }
  });

  const context = await callUpload(client, "uploadFlux3I2vImage", probe, "uploaded") as Record<string, unknown>;
  assert.equal(network.calls, 1);
  assert.equal(credentials.calls, 1);
  assert.equal(context.status, "OWNER_FLUX3_I2V_IMAGE_UPLOADED");
  assert.equal(context.model_id, "flux3_i2v");
  assert.equal(context.ai_name, "flux3_video");
  assert.equal(context.destination, "uploaded");
  assert.equal(context.source_mime_type, "image/png");
  assert.equal(context.mime_type, "image/png");
  assert.equal(context.size, source.byteLength);
  assert.equal(context.width, 1);
  assert.equal(context.height, 1);
  assert.equal("url" in context, false);
  assert.equal(JSON.stringify(context).includes(IMAGE_URL), false);
  assert.equal(submitted?.get("files"), null);

  const module = await import("../src/adapter/syntx/chat-http-client.js");
  const readReference = Reflect.get(module, "readOwnerFlux3UploadReferenceForClient");
  assert.equal(typeof readReference, "function");
  assert.deepEqual(Reflect.apply(readReference as (c: unknown, r: unknown) => unknown, undefined, [client, context]),
    { ...context, url: IMAGE_URL });
  assert.equal(Reflect.apply(readReference as (c: unknown, r: unknown) => unknown, undefined, [client, { ...context }]), null);
  const other = new SyntxChatHttpClient({ credentialBroker: broker({ calls: 0 }), fetchImpl: async () => jsonResponse({}) });
  assert.equal(Reflect.apply(readReference as (c: unknown, r: unknown) => unknown, undefined, [other, context]), null);
  assert.ok(readOwnerFlux3I2vImageBytes(probe));
  assert.deepEqual(Array.from(source), Array.from(IMAGE_PNG));
});

test("Flux3 V2V uploads one probed MP4 with model-scoped multipart binding and private URL witness",
  { skip: process.platform === "win32" ? "POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN" : false },
  async () => {
    const fixture = await fakeFfprobe();
    try {
      const source = mp4Bytes();
      const probe = await probeOwnerFlux3V2vOriginal({ model_id: "flux3_v2v", filename: "original.mp4",
        mime_type: "video/mp4", bytes: source, ffprobePath: fixture.binary });
      const network = { calls: 0 }, credentials = { calls: 0 };
      let submitted: FormData | undefined;
      const client = new SyntxChatHttpClient({
        credentialBroker: broker(credentials),
        fetchImpl: async (input, init) => {
          network.calls += 1;
          assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
          assert.equal(init?.method, "POST");
          const form = init?.body as FormData;
          submitted = form;
          assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
          assert.equal(form.get("destination"), "hidden");
          assert.equal(form.get("check_duplicates"), "true");
          assert.equal(form.get("model_type"), "flux3_v2v");
          const file = form.get("files");
          assert.ok(file instanceof File);
          assert.equal(file.name, "original.mp4");
          assert.equal(file.type, "video/mp4");
          assert.equal(file.size, source.byteLength);
          assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
          return jsonResponse({ files: [{ url: VIDEO_URL, filename: "original.mp4", status: "success",
            size: source.byteLength, content_type: "video/mp4" }] });
        }
      });

      const context = await callUpload(client, "uploadFlux3V2vOriginal", probe, "hidden") as Record<string, unknown>;
      assert.equal(network.calls, 1);
      assert.equal(credentials.calls, 1);
      assert.equal(context.status, "OWNER_FLUX3_V2V_ORIGINAL_UPLOADED");
      assert.equal(context.model_id, "flux3_v2v");
      assert.equal(context.ai_name, "flux3_video");
      assert.equal(context.destination, "hidden");
      assert.equal(context.source_mime_type, "video/mp4");
      assert.equal(context.mime_type, "video/mp4");
      assert.equal(context.size, source.byteLength);
      assert.equal("url" in context, false);
      assert.equal(JSON.stringify(context).includes(VIDEO_URL), false);
      assert.equal(submitted?.get("files"), null);
      assert.deepEqual(context.metadata, probe.metadata);
      assert.equal(isOwnerFlux3V2vOriginalProbe(probe), true);
      assert.deepEqual(Array.from(readOwnerFlux3V2vOriginalProbeBytes(probe)), Array.from(source));

      const module = await import("../src/adapter/syntx/chat-http-client.js");
      const readReference = Reflect.get(module, "readOwnerFlux3UploadReferenceForClient");
      assert.equal(typeof readReference, "function");
      assert.deepEqual(Reflect.apply(readReference as (c: unknown, r: unknown) => unknown, undefined, [client, context]),
        { ...context, url: VIDEO_URL });
      releaseOwnerFlux3V2vOriginalProbe(probe);
      const other = new SyntxChatHttpClient({ credentialBroker: broker({ calls: 0 }), fetchImpl: async () => jsonResponse({}) });
      assert.equal(Reflect.apply(readReference as (c: unknown, r: unknown) => unknown, undefined, [other, context]), null);
      assert.deepEqual(Array.from(source), Array.from(mp4Bytes()));
      source.fill(0);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

test("Flux3 upload rejects foreign/forged probes and invalid destinations before credential or POST", async () => {
  const source = new Uint8Array(IMAGE_PNG);
  const probe = validateOwnerFlux3I2vImage({ model_id: "flux3_i2v", filename: "scene.png", mime_type: "image/png", bytes: source });
  const network = { calls: 0 }, credentials = { calls: 0 };
  const client = new SyntxChatHttpClient({ credentialBroker: broker(credentials), fetchImpl: async () => {
    network.calls += 1;
    return jsonResponse({ files: [{ url: IMAGE_URL }] });
  } });
  for (const [methodName, candidate, destination] of [
    ["uploadFlux3I2vImage", { ...probe }, "uploaded"],
    ["uploadFlux3I2vImage", new Proxy(probe, {}), "uploaded"],
    ["uploadFlux3I2vImage", probe, "public"],
    ["uploadFlux3V2vOriginal", probe, "uploaded"]
  ] as const) {
    await assert.rejects(callUpload(client, methodName, candidate, destination),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(credentials.calls, 0);
  assert.equal(network.calls, 0);
  assert.ok(readOwnerFlux3I2vImageBytes(probe));
  releaseOwnerFlux3I2vImage(probe);
});

test("Flux3 upload rejects mismatching response metadata after one POST without exposing a witness", async () => {
  const mismatches = [
    { filename: "other.png", status: "success", size: IMAGE_PNG.byteLength, content_type: "image/png" },
    { filename: "scene.png", status: "success", size: IMAGE_PNG.byteLength, content_type: "image/jpeg" },
    { filename: "scene.png", status: "success", size: IMAGE_PNG.byteLength + 1, mime_type: "image/png" },
    { filename: "scene.png", status: "pending", size: IMAGE_PNG.byteLength, mime_type: "image/png" }
  ];
  for (const file of mismatches) {
    const source = new Uint8Array(IMAGE_PNG);
    const probe = validateOwnerFlux3I2vImage({ model_id: "flux3_i2v", filename: "scene.png", mime_type: "image/png", bytes: source });
    const network = { calls: 0 };
    const client = new SyntxChatHttpClient({ credentialBroker: broker({ calls: 0 }), fetchImpl: async () => {
      network.calls += 1;
      return jsonResponse({ files: [{ url: IMAGE_URL, ...file }] });
    } });
    await assert.rejects(callUpload(client, "uploadFlux3I2vImage", probe, "uploaded"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
    assert.equal(network.calls, 1);
    const module = await import("../src/adapter/syntx/chat-http-client.js");
    const readReference = Reflect.get(module, "readOwnerFlux3UploadReferenceForClient");
    assert.equal(Reflect.apply(readReference as (c: unknown, r: unknown) => unknown, undefined, [client, probe]), null);
    assert.ok(readOwnerFlux3I2vImageBytes(probe));
    releaseOwnerFlux3I2vImage(probe);
  }
});
