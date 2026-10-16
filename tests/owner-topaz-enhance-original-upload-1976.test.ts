import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createOwnerTopazEnhanceOriginalProbe,
  releaseTrustedOwnerTopazEnhanceOriginalProbeResult
} from "../src/application/owner-topaz-enhance-original-probe.js";
import {
  readOwnerTopazEnhanceOriginalUploadForClient,
  SyntxChatHttpClient
} from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SOURCE_CATALOG = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CREDENTIAL = "synthetic-topaz-enhance-upload-credential";
const URL = "https://r2.syntx.ai/topaz-enhance/uploaded/source.mp4";
const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "60", duration: "2.000000", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "aac", duration: "2.000000" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000" }
});

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

function probeInput(bytes = mp4Bytes()): Record<string, unknown> {
  return { model_id: "topaz_enhance", ai_name: "topaz_ai", source_catalog_version: SOURCE_CATALOG,
    filename: "source.mp4", mime_type: "video/mp4", bytes };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function broker(counter: { calls: number }): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    counter.calls += 1;
    return operation(CREDENTIAL);
  } };
}

async function fakeFfprobe(output = PROBE_JSON): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-upload-1976-"));
  const binary = join(directory, "ffprobe-fixture");
  const quoted = output.replaceAll("'", "'\\''");
  await writeFile(binary, `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nfor last do :; done\n[ -f "$last" ] || exit 32\nprintf '%s' '${quoted}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

async function trustedProbe(binary: string, bytes = mp4Bytes()) {
  return createOwnerTopazEnhanceOriginalProbe({ ffprobePath: binary }).probe(probeInput(bytes));
}

test("Enhance native upload posts exactly one bound MP4 and retains its URL only for the same client", async () => {
  const fixture = await fakeFfprobe();
  try {
    const source = mp4Bytes();
    const probe = await trustedProbe(fixture.binary, source);
    const network = { calls: 0 };
    const credentials = { calls: 0 };
    let submitted: FormData | undefined;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(credentials),
      fetchImpl: async (input, init) => {
        network.calls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        submitted = init?.body as FormData;
        assert.deepEqual(Array.from(submitted.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(submitted.get("destination"), "uploaded");
        assert.equal(submitted.get("check_duplicates"), "true");
        assert.equal(submitted.get("model_type"), "topaz_enhance");
        const file = submitted.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, "source.mp4");
        assert.equal(file.type, "video/mp4");
        assert.equal(file.size, source.byteLength);
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
        return jsonResponse({ files: [{ url: URL, filename: "source.mp4", status: "success",
          size: source.byteLength, content_type: "video/mp4", duration: 2 }] });
      }
    });

    const context = await client.uploadTopazEnhanceOriginal(probe, "uploaded");
    assert.equal(network.calls, 1);
    assert.equal(credentials.calls, 1);
    assert.equal(context.status, "OWNER_TOPAZ_ENHANCE_ORIGINAL_UPLOADED");
    assert.equal(context.model_id, "topaz_enhance");
    assert.equal(context.ai_name, "topaz_ai");
    assert.equal(context.source_catalog_version, SOURCE_CATALOG);
    assert.equal(context.source_size, source.byteLength);
    assert.equal(context.source_mime_type, "video/mp4");
    assert.equal(context.width, 640);
    assert.equal(context.height, 360);
    assert.equal(context.duration_seconds, 2);
    assert.equal(context.frame_count, 60);
    assert.equal("url" in context, false);
    assert.equal(JSON.stringify(context).includes(URL), false);
    assert.deepEqual(readOwnerTopazEnhanceOriginalUploadForClient(client, context), { ...context, url: URL });

    const otherClient = new SyntxChatHttpClient({ credentialBroker: broker({ calls: 0 }), fetchImpl: async () => jsonResponse({}) });
    assert.equal(readOwnerTopazEnhanceOriginalUploadForClient(otherClient, context), null);
    releaseTrustedOwnerTopazEnhanceOriginalProbeResult(probe);
    assert.deepEqual(readOwnerTopazEnhanceOriginalUploadForClient(client, context), { ...context, url: URL });
    assert.ok(submitted);
    assert.equal(submitted.get("files"), null);
    source.fill(0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Enhance upload rejects forged probes and invalid destinations before credentials or POST", async () => {
  const fixture = await fakeFfprobe();
  try {
    const probe = await trustedProbe(fixture.binary);
    const network = { calls: 0 };
    const credentials = { calls: 0 };
    const client = new SyntxChatHttpClient({ credentialBroker: broker(credentials), fetchImpl: async () => {
      network.calls += 1;
      return jsonResponse({ files: [{ url: URL }] });
    } });
    for (const [candidate, destination] of [
      [{ ...probe }, "uploaded"],
      [new Proxy(probe, {}), "uploaded"],
      [probe, "public"]
    ] as const) {
      await assert.rejects(client.uploadTopazEnhanceOriginal(candidate, destination as "uploaded"),
        (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    }
    assert.equal(credentials.calls, 0);
    assert.equal(network.calls, 0);
    releaseTrustedOwnerTopazEnhanceOriginalProbeResult(probe);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Enhance ambiguous upload is one POST only and is not automatically retried", async () => {
  const fixture = await fakeFfprobe();
  try {
    const source = mp4Bytes();
    source[27] = 0x41;
    const probe = await trustedProbe(fixture.binary, source);
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker({ calls: 0 }), fetchImpl: async () => {
      calls += 1;
      throw new Error("synthetic lost upload acknowledgement");
    } });
    await assert.rejects(client.uploadTopazEnhanceOriginal(probe, "uploaded"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE");
    assert.equal(calls, 1);
    releaseTrustedOwnerTopazEnhanceOriginalProbeResult(probe);
    source.fill(0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Enhance upload rejects a malformed or non-R2 receipt after one POST", async () => {
  const fixture = await fakeFfprobe();
  try {
    const source = mp4Bytes();
    source[27] = 0x42;
    const malformedProbe = await trustedProbe(fixture.binary, source);
    let networkCalls = 0;
    const malformed = new SyntxChatHttpClient({ credentialBroker: broker({ calls: 0 }), fetchImpl: async () => {
      networkCalls += 1;
      return jsonResponse({ files: [{ url: "https://example.invalid/source.mp4", status: "pending" }] });
    } });
    await assert.rejects(malformed.uploadTopazEnhanceOriginal(malformedProbe, "uploaded"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
    assert.equal(networkCalls, 1);
    releaseTrustedOwnerTopazEnhanceOriginalProbeResult(malformedProbe);
    source.fill(0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
