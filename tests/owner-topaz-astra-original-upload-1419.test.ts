import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOwnerTopazAstraOriginalProbe,
  isTrustedOwnerTopazAstraOriginalProbeResult,
  releaseTrustedOwnerTopazAstraOriginalProbeResult
} from "../src/application/owner-topaz-astra-original-probe.js";
import {
  readOwnerTopazAstraOriginalUploadForClient,
  SyntxChatHttpClient
} from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-topaz-upload-credential";
const URL = "https://r2.syntx.ai/topaz/uploaded/source.mp4";
const GOOD_PROBE = JSON.stringify({
  streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "72", duration: "3.000000" }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000" }
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

async function fakeFfprobe(output = GOOD_PROBE): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-upload-fixture-"));
  const binary = join(directory, "ffprobe-fixture");
  const quoted = output.replaceAll("'", "'\\''");
  await writeFile(binary, `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nprintf '%s' '${quoted}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary };
}

async function genuineProbe(binary: string, bytes = new Uint8Array(64)) {
  return createOwnerTopazAstraOriginalProbe({ ffprobePath: binary }).probe({
    model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", bytes
  });
}

test("Topaz upload accepts a trusted >10 MiB source, seals a private same-client URL, and wipes its copy", async () => {
  const fixture = await fakeFfprobe();
  try {
    const inputBytes = new Uint8Array(11 * 1024 * 1024).fill(0x5a);
    const probe = await genuineProbe(fixture.binary, inputBytes);
    let fetchCalls = 0;
    let credentialCalls = 0;
    let submittedForm: FormData | undefined;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker({ get calls() { return credentialCalls; }, set calls(value: number) { credentialCalls = value; } }),
      fetchImpl: async (input, init) => {
        fetchCalls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        submittedForm = init?.body as FormData;
        assert.deepEqual(Array.from(submittedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(submittedForm.get("destination"), "hidden");
        assert.equal(submittedForm.get("check_duplicates"), "true");
        assert.equal(submittedForm.get("model_type"), "slc-1");
        const file = submittedForm.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, "source.mp4");
        assert.equal(file.type, "video/mp4");
        assert.equal(file.size, 11 * 1024 * 1024);
        assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer()).subarray(0, 4)), [0x5a, 0x5a, 0x5a, 0x5a]);
        return jsonResponse({ files: [{ url: URL, status: "success", size: file.size, content_type: "video/mp4", duration: 3.4, id: "ignored" }] });
      }
    });
    const context = await client.uploadTopazAstraOriginal(probe, "hidden");
    inputBytes.fill(0);
    assert.equal(fetchCalls, 1);
    assert.equal(credentialCalls, 1);
    assert.equal(context.status, "OWNER_TOPAZ_ASTRA_ORIGINAL_UPLOADED");
    assert.equal(context.source_size, 11 * 1024 * 1024);
    assert.equal(context.duration_seconds, 3);
    assert.equal("url" in context, false);
    assert.equal(JSON.stringify(context).includes(URL), false);
    assert.deepEqual(readOwnerTopazAstraOriginalUploadForClient(client, context), { ...context, url: URL });
    assert.equal(readOwnerTopazAstraOriginalUploadForClient(
      new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse({}) }), context), null);
    releaseTrustedOwnerTopazAstraOriginalProbeResult(probe);
    assert.equal(isTrustedOwnerTopazAstraOriginalProbeResult(probe), false);
    assert.deepEqual(readOwnerTopazAstraOriginalUploadForClient(client, context), { ...context, url: URL },
      "releasing the probe does not invalidate the already-owned upload context");
    assert.ok(submittedForm);
    assert.equal(submittedForm.get("files"), null);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Topaz upload rejects clones and invalid destinations before credential access", async () => {
  const fixture = await fakeFfprobe();
  try {
    const probe = await genuineProbe(fixture.binary);
    let credentialCalls = 0;
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker({ get calls() { return credentialCalls; }, set calls(value: number) { credentialCalls = value; } }),
      fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [{ url: URL }] }); }
    });
    for (const [candidate, destination] of [[{ ...probe }, "uploaded"], [probe, "public"], [new Proxy(probe, {}), "uploaded"]] as const) {
      await assert.rejects(client.uploadTopazAstraOriginal(candidate, destination as never),
        (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    }
    assert.equal(credentialCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Topaz upload rejects ambiguous or malformed receipt after one POST without replay", async () => {
  const fixture = await fakeFfprobe();
  try {
    const probe = await genuineProbe(fixture.binary);
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/topaz/file.mp4", status: "pending", size: 65, content_type: "video/mp4", duration: 3 }] });
    } });
    await assert.rejects(client.uploadTopazAstraOriginal(probe, "uploaded"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
    assert.equal(calls, 1);

    const ambiguous = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
      calls += 1;
      throw new Error("synthetic lost upload acknowledgement");
    } });
    await assert.rejects(ambiguous.uploadTopazAstraOriginal(probe, "uploaded"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE");
    assert.equal(calls, 2);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Topaz enforces its 50 MiB source ceiling while generic upload remains capped at 10 MiB", async () => {
  const fixture = await fakeFfprobe();
  try {
    const probeRunner = createOwnerTopazAstraOriginalProbe({ ffprobePath: fixture.binary });
    await assert.rejects(probeRunner.probe({
      model_id: "slc-1", filename: "large.mp4", mime_type: "video/mp4", bytes: new Uint8Array(50 * 1024 * 1024 + 1)
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    const overTenButAllowed = new Uint8Array(11 * 1024 * 1024);
    const probe = await probeRunner.probe({ model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", bytes: overTenButAllowed });
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
      calls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.size, overTenButAllowed.byteLength);
      return jsonResponse({ files: [{ url: URL }] });
    } });
    await client.uploadTopazAstraOriginal(probe, "uploaded");
    assert.equal(calls, 1);
    await assert.rejects(client.uploadFile({ bytes: overTenButAllowed, filename: "source.mp4", mime_type: "video/mp4",
      destination: "uploaded", check_duplicates: true, model_type: "legacy" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
    assert.equal(calls, 1, "the generic 10 MiB upload path does not inherit Topaz's 50 MiB allowance");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
