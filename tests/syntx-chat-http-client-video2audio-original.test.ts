import assert from "node:assert/strict";
import test from "node:test";
import {
  isOwnerVideo2AudioOriginalReferenceForClient,
  readOwnerVideo2AudioOriginalReferenceForClient,
  SyntxChatHttpClient
} from "../src/adapter/syntx/chat-http-client.js";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-video2audio-credential";
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const URL = "https://r2.syntx.ai/video2audio/uploaded/original.mp4";

function broker(counter?: { calls: number }): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    if (counter) counter.calls += 1;
    return operation(CREDENTIAL);
  } };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    total: 1,
    successful: 1,
    failed: 0,
    duplicates: 0,
    files: [{
      filename: "original.mp4",
      url: URL,
      status: "success",
      content_type: "video/mp4",
      size: MP4.byteLength,
      hash: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      path: "opaque-storage-path",
      uuid: "opaque-upload-uuid",
      preview_url: "https://r2.syntx.ai/video2audio/preview.mp4",
      duration: 5.64,
      is_hdr: false,
      width: 1280,
      height: 720,
      aspect_ratio: "16:9",
      extra_metadata: { ignored: true }
    }],
    ...overrides
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function upload(client: SyntxChatHttpClient, request: unknown, signal?: AbortSignal) {
  return client.uploadVideo2AudioOriginal(request, signal);
}

test("Video2Audio upload sends one fixed multipart POST and returns a URL-free witness bound to client and source", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  let form: FormData | undefined;
  const client = new SyntxChatHttpClient({ credentialBroker: broker({ get calls() { return credentialCalls; }, set calls(value: number) { credentialCalls = value; } }), fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "video2audio");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "original.mp4");
    assert.equal(file.type, "video/mp4");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), MP4);
    return jsonResponse(receipt());
  } });
  const profile = createOwnerVideo2AudioSourceProfile();
  const original = new Uint8Array(MP4);
  const originalBeforeUpload = new Uint8Array(original);
  const reference = await upload(client, { bytes: original, filename: "original.mp4", mime_type: "video/mp4" });
  assert.deepEqual(original, originalBeforeUpload);
  original.fill(0);

  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
  assert.equal(reference.status, "OWNER_VIDEO2AUDIO_ORIGINAL_UPLOADED");
  assert.equal(reference.sha256.length, 71);
  assert.equal(reference.mime_type, "video/mp4");
  assert.equal(reference.size, MP4.byteLength);
  assert.equal(reference.duration_seconds, 5.64);
  assert.equal("url" in reference, false);
  assert.equal(JSON.stringify(reference).includes(URL), false);
  assert.equal(isOwnerVideo2AudioOriginalReferenceForClient(client, profile, reference), true);
  assert.deepEqual(readOwnerVideo2AudioOriginalReferenceForClient(client, profile, reference), {
    ...reference,
    url: URL
  });
  assert.equal(isOwnerVideo2AudioOriginalReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse(receipt()) }), profile, reference), false);
  assert.equal(isOwnerVideo2AudioOriginalReferenceForClient(client, profile, { ...reference }), false);
  assert.ok(form);
  assert.equal(form.get("files"), null, "multipart body releases the uploaded file after the request");
});

test("Video2Audio upload rejects forged caller selectors and URL before credentials or POST", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker({ get calls() { return credentialCalls; }, set calls(value: number) { credentialCalls = value; } }), fetchImpl: async () => {
    fetchCalls += 1;
    return jsonResponse(receipt());
  } });
  const base = { bytes: MP4, filename: "original.mp4", mime_type: "video/mp4" };
  for (const hostile of [
    { ...base, duration: 5.64 }, { ...base, duration_seconds: 5.64 }, { ...base, url: URL },
    { ...base, model_type: "other" }, { ...base, destination: "hidden" }, { ...base, extra: true },
    { bytes: MP4, filename: "original.mp4", mime_type: "video/quicktime" }
  ]) {
    await assert.rejects(upload(client, hostile), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetchCalls, 0);
  assert.equal(credentialCalls, 0);
});

test("Video2Audio upload requires a successful single receipt with matching MP4 and trusted duration", async () => {
  const bad = [
    receipt({ files: [] }),
    receipt({ total: 2 }),
    receipt({ successful: 0 }),
    receipt({ failed: 1 }),
    receipt({ duplicates: 1 }),
    receipt({ files: [{ ...receipt().files[0], status: "pending" }] }),
    receipt({ files: [{ ...receipt().files[0], content_type: "video/quicktime" }] }),
    receipt({ files: [{ ...receipt().files[0], size: MP4.byteLength + 1 }] }),
    receipt({ files: [{ ...receipt().files[0], duration: undefined }] }),
    receipt({ files: [{ ...receipt().files[0], duration: 0 }] }),
    receipt({ files: [{ ...receipt().files[0], duration: 20.01 }] }),
    receipt({ files: [{ ...receipt().files[0], filename: "other.mp4" }] }),
    receipt({ files: [{ ...receipt().files[0], url: "https://attacker.invalid/original.mp4" }] }),
    receipt({ files: [{ ...receipt().files[0], url: "http://r2.syntx.ai/original.mp4" }] }),
    receipt({ files: [{ ...receipt().files[0], url: "https://r2.syntx.ai/original.mp4#fragment" }] })
  ];
  let index = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    fetchCalls += 1;
    return jsonResponse(bad[index++]);
  } });
  for (const _response of bad) {
    await assert.rejects(upload(client, { bytes: MP4, filename: "original.mp4", mime_type: "video/mp4" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
  assert.equal(fetchCalls, bad.length);
});

test("Video2Audio upload preserves the source and never retries an ambiguous or aborted POST", async () => {
  let postCalls = 0;
  const ambiguousClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    postCalls += 1;
    throw new Error("synthetic lost acknowledgement");
  } });
  await assert.rejects(upload(ambiguousClient, { bytes: MP4, filename: "original.mp4", mime_type: "video/mp4" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE");
  assert.equal(postCalls, 1);

  const abort = new AbortController(); abort.abort();
  await assert.rejects(upload(ambiguousClient, { bytes: MP4, filename: "original.mp4", mime_type: "video/mp4" }, abort.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(postCalls, 1);
});

test("generic startAudio continues rejecting URL-bearing references without a native owned handle", async () => {
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    fetchCalls += 1;
    return jsonResponse({ id: "audio-message" });
  } });
  await assert.rejects(client.startAudio({
    ai_name: "video2audio",
    chat_uuid: "audio-chat",
    prompt: "Generate audio from the supplied video.",
    settings: { model_type: "video2audio", file_urls: [{ type: "video", url: URL }] }
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(fetchCalls, 0);
});
