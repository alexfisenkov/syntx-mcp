import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import { probeOwnerGrokV2vOriginal, releaseOwnerGrokV2vOriginalProbe } from "../src/application/owner-grok-v2v-original-probe.js";

const ARTIFACT_URL = "https://r2.syntx.ai/grok-v2v/hidden/original.mp4";
const fixtureMetadata = {
  streams: [{ codec_type: "video", codec_name: "h264", width: 960, height: 432,
    duration: "6.2", disposition: { attached_pic: 0 } }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "6.25" }
};

function originalBytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-upload-2060-"));
  const path = join(directory, "ffprobe-fixture");
  const json = JSON.stringify(fixtureMetadata).replaceAll("'", "'\\''");
  await writeFile(path, `#!/bin/sh\nfor last do :; done\n[ -f "$last" ] || exit 32\nprintf '%s' '${json}'\n`, { flag: "wx", mode: 0o700 });
  await chmod(path, 0o700);
  return { directory, binary: await realpath(path) };
}

function uploadMethod(client: SyntxChatHttpClient) {
  const value = Reflect.get(client, "uploadGrokV2vOriginal");
  assert.equal(typeof value, "function", "Native Grok upload must be available before binding a probe");
  // Dynamic boundary also exercises deliberately invalid destinations below.
  return value as unknown as (probe: unknown, destination: string) => Promise<Record<string, unknown>>;
}

const posixFixture = { skip: process.platform === "win32" ? "POSIX fixture; Windows ffprobe NOT_RUN" : false };

test("Grok V2V native upload sends one bound original and keeps its URL in the same client witness", posixFixture, async () => {
  let calls = 0, credentials = 0;
  let submitted: FormData | undefined;
  const source = originalBytes();
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential(operation) { credentials++; return operation("synthetic-grok-upload-credential"); } },
    fetchImpl: async (input, init) => {
      calls++;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      submitted = init?.body as FormData;
      assert.deepEqual([...submitted.keys()], ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(submitted.get("model_type"), "grok_v2v");
      assert.equal(submitted.get("destination"), "hidden");
      assert.equal(submitted.get("check_duplicates"), "true");
      const file = submitted.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "original.mp4");
      assert.equal(file.type, "video/mp4");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
      return new Response(JSON.stringify({ files: [{ url: ARTIFACT_URL, filename: "original.mp4",
        status: "success", size: source.byteLength, content_type: "video/mp4" }] }),
      { headers: { "content-type": "application/json" } });
    }
  });
  const upload = uploadMethod(client);
  const own = await fixture();
  let probe: Awaited<ReturnType<typeof probeOwnerGrokV2vOriginal>> | undefined;
  try {
    probe = await probeOwnerGrokV2vOriginal({ model_id: "grok_v2v", filename: "original.mp4",
      mime_type: "video/mp4", bytes: source, ffprobePath: own.binary });
    const context = await Reflect.apply(upload, client, [probe, "hidden"]);
    assert.equal(calls, 1);
    assert.equal(credentials, 1);
    assert.equal(context.model_id, "grok_v2v");
    assert.equal(context.ai_name, "grok_video");
    assert.equal(context.destination, "hidden");
    assert.equal(context.size, source.byteLength);
    assert.deepEqual(context.metadata, probe.metadata);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.hasOwn(context, "url"), false);
    assert.equal(JSON.stringify(context).includes(ARTIFACT_URL), false);
    assert.equal(submitted?.get("files"), null);
    const module = await import("../src/adapter/syntx/chat-http-client.js");
    const read = Reflect.get(module, "readOwnerGrokV2vUploadReferenceForClient") as ((c: unknown, r: unknown) => unknown) | undefined;
    assert.equal(typeof read, "function");
    assert.deepEqual(read!(client, context), { ...context, url: ARTIFACT_URL });
    assert.equal(read!(client, { ...context }), null);
    const other = new SyntxChatHttpClient({ credentialBroker: { async useCredential(_operation) {
      throw new Error("The other client must not read credentials");
    } } });
    assert.equal(read!(other, context), null);
    assert.deepEqual(source, originalBytes());
  } finally {
    if (probe) releaseOwnerGrokV2vOriginalProbe(probe);
    await rm(own.directory, { recursive: true, force: true });
  }
});

test("Grok native upload rejects forged probes, destinations and a shadowed client before any credential or network read", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential() { calls++; throw new Error("Unexpected credential read"); } },
    fetchImpl: async () => { calls++; throw new Error("Unexpected request"); }
  });
  const upload = uploadMethod(client);
  const invalid = (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST";
  await assert.rejects(() => Reflect.apply(upload, client, [{ model_id: "grok_v2v" }, "hidden"]), invalid);
  await assert.rejects(() => Reflect.apply(upload, client, [null, "unlisted"]), invalid);
  Object.defineProperty(client, "uploadGrokV2vOriginal", { value: async () => undefined });
  await assert.rejects(() => Reflect.apply(upload, client, [null, "hidden"]), invalid);
  assert.equal(calls, 0);
});
