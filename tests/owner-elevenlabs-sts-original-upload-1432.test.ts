import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnerElevenLabsStsOriginalProbe, isTrustedOwnerElevenLabsStsOriginalProbeResult,
  releaseTrustedOwnerElevenLabsStsOriginalProbeResult } from "../src/application/owner-elevenlabs-sts-original-probe.js";
import { createOwnerElevenLabsStsOriginalUploadAdapter } from "../src/adapter/syntx/owner-elevenlabs-sts-original-upload.js";
import { readOwnerElevenLabsStsOriginalUploadForClient, SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-sts-upload-credential";
const R2_URL = "https://r2.syntx.ai/eleven/uploaded/source.mp3";
const GOOD_AUDIO = JSON.stringify({
  streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "24000", channels: 1, nb_read_frames: "432", duration: "11.06" }],
  format: { format_name: "mp3", duration: "11.06" }
});

function broker(counter?: { calls: number }): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    if (counter) counter.calls += 1;
    return operation(CREDENTIAL);
  } };
}
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}
async function fakeFfprobe(output = GOOD_AUDIO): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-eleven-sts-upload-test-"));
  const binary = join(directory, "ffprobe-fixture");
  const quoted = output.replaceAll("'", "'\\''");
  await writeFile(binary, `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nprintf '%s' '${quoted}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary };
}
async function genuineProbe(binary: string, bytes = new Uint8Array(64).fill(0x5a)) {
  return createOwnerElevenLabsStsOriginalProbe({ ffprobePath: binary }).probe({ filename: "source.mp3", mime_type: "audio/mpeg", bytes });
}

test("native STS upload accepts genuine probe bytes and keeps URL in an exact same-client witness", async () => {
  const fixture = await fakeFfprobe();
  try {
    const source = new Uint8Array(11 * 1024 * 1024).fill(0x5a);
    const probe = await genuineProbe(fixture.binary, source);
    let fetchCalls = 0;
    let credentialCalls = 0;
    let submittedForm: FormData | undefined;
    const client = new SyntxChatHttpClient({ credentialBroker: broker({ get calls() { return credentialCalls; }, set calls(v: number) { credentialCalls = v; } }),
      fetchImpl: async (input, init) => {
        fetchCalls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        submittedForm = init?.body as FormData;
        assert.deepEqual(Array.from(submittedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(submittedForm.get("destination"), "hidden");
        assert.equal(submittedForm.get("check_duplicates"), "true");
        assert.equal(submittedForm.get("model_type"), "eleven_multilingual_sts_v2");
        const file = submittedForm.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, "source.mp3");
        assert.equal(file.type, "audio/mpeg");
        assert.equal(file.size, source.byteLength);
        assert.equal(new Uint8Array(await file.arrayBuffer())[0], 0x5a);
        return jsonResponse({ files: [{ url: R2_URL, filename: "source.mp3", status: "success", size: file.size,
          content_type: "audio/mpeg", duration: 11.4 }] });
      }
    });
    const reference = await createOwnerElevenLabsStsOriginalUploadAdapter(client).upload(probe, "hidden");
    source.fill(0);
    assert.equal(fetchCalls, 1);
    assert.equal(credentialCalls, 1);
    assert.deepEqual(reference, { status: "OWNER_ELEVENLABS_STS_ORIGINAL_UPLOADED", source_sha256: probe.source_sha256,
      size: 11 * 1024 * 1024, mime_type: "audio/mpeg", duration_seconds: 11.06 });
    assert.equal(JSON.stringify(reference).includes(R2_URL), false);
    assert.equal(isTrustedOwnerElevenLabsStsOriginalProbeResult(probe), true, "native upload does not release borrowed probe evidence");
    assert.deepEqual(readOwnerElevenLabsStsOriginalUploadForClient(client, reference), { ...reference, destination: "hidden",
      model_type: "eleven_multilingual_sts_v2", url: R2_URL });
    assert.equal(readOwnerElevenLabsStsOriginalUploadForClient(client, { ...reference }), null);
    assert.equal(readOwnerElevenLabsStsOriginalUploadForClient(
      new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse({}) }), reference), null);
    releaseTrustedOwnerElevenLabsStsOriginalProbeResult(probe);
    assert.deepEqual(readOwnerElevenLabsStsOriginalUploadForClient(client, reference), { ...reference, destination: "hidden",
      model_type: "eleven_multilingual_sts_v2", url: R2_URL });
    assert.ok(submittedForm);
    assert.equal(submittedForm.get("files"), null);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("native STS upload rejects forged probe and destination before credential or fetch", async () => {
  const fixture = await fakeFfprobe();
  try {
    const probe = await genuineProbe(fixture.binary);
    let credentialCalls = 0;
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker({ get calls() { return credentialCalls; }, set calls(v: number) { credentialCalls = v; } }),
      fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [{ url: R2_URL }] }); } });
    const adapter = createOwnerElevenLabsStsOriginalUploadAdapter(client);
    const fakeClient = createOwnerElevenLabsStsOriginalUploadAdapter({ uploadElevenLabsStsOriginal: async () => { fetchCalls += 1; } });
    await assert.rejects(fakeClient.upload(probe, "uploaded"), (error: unknown) =>
      error instanceof Error && error.name === "OwnerElevenLabsStsOriginalUploadError");
    await assert.rejects(createOwnerElevenLabsStsOriginalUploadAdapter(new Proxy(client, {})).upload(probe, "uploaded"));
    for (const [candidate, destination] of [[{ ...probe }, "uploaded"], [probe, "public"], [new Proxy(probe, {}), "uploaded"]] as const) {
      await assert.rejects(adapter.upload(candidate, destination as never));
    }
    assert.equal(credentialCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("malformed semantic 2xx upload receipt rejects after exactly one POST", async () => {
  const fixture = await fakeFfprobe();
  try {
    const probe = await genuineProbe(fixture.binary);
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ files: [{ url: R2_URL, status: "failed", size: 64, content_type: "audio/mpeg", duration: 11.06 }] });
    } });
    await assert.rejects(client.uploadElevenLabsStsOriginal(probe, "uploaded"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
    assert.equal(calls, 1);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("STS native path admits >10 MiB and independently enforces its 50 MiB bound", async () => {
  const fixture = await fakeFfprobe();
  try {
    const runner = createOwnerElevenLabsStsOriginalProbe({ ffprobePath: fixture.binary });
    const oversized = new Uint8Array(50 * 1024 * 1024 + 1);
    await assert.rejects(runner.probe({ filename: "large.mp3", mime_type: "audio/mpeg", bytes: oversized }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    const overTen = new Uint8Array(11 * 1024 * 1024).fill(0x2a);
    const probe = await genuineProbe(fixture.binary, overTen);
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
      calls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.size, overTen.byteLength);
      return jsonResponse({ files: [{ url: R2_URL }] });
    } });
    await client.uploadElevenLabsStsOriginal(probe, "uploaded");
    assert.equal(calls, 1);
    await assert.rejects(client.uploadFile({ bytes: overTen, filename: "source.mp3", mime_type: "audio/mpeg",
      destination: "uploaded", check_duplicates: true, model_type: "eleven_multilingual_sts_v2" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(calls, 1);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
