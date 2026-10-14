import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient, readOwnerElevenLabsStsOriginalUploadForClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import test from "node:test";

const ATTEMPT = "link_sts_original_owner_0123456789";
const OTHER_ATTEMPT = "link_sts_original_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "sts-original-tenant", subject: "sts-original-owner" });
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const UPLOAD_URL = "https://r2.syntx.ai/elevenlabs/uploaded/source.mp3";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-sts-owner-credential"); } };
}
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
async function createLinkedOwners(attemptIds: readonly string[], now = () => 1_000): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${attemptIds[index - 1]}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => attemptIds[index++]! });
  for (const attemptId of attemptIds) {
    await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId);
  }
  return links;
}
async function ffprobeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "syntx-sts-original-service-"));
  const binary = join(directory, "ffprobe");
  const output = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2,
    nb_read_frames: "500", duration: "11.006259" }], format: { format_name: "mp3", duration: "11.006259" } });
  await writeFile(binary, `#!/bin/sh\nprintf '%s' '${output}'\n`);
  await chmod(binary, 0o700);
  return { directory, binary };
}
function successClient(onUpload: () => void = () => {}) {
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    onUpload();
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/chats/upload-files");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "eleven_multilingual_sts_v2");
    const file = form.get("files"); assert.ok(file instanceof File);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), MP3);
    return response({ files: [{ filename: "source.mp3", url: UPLOAD_URL, status: "success", size: MP3.byteLength,
      content_type: "audio/mpeg", duration: 11.006259 }] });
  } });
}
function createService(ffprobePath: string, linkService: PerUserLinkService, resolveClient: (attemptId: string) => unknown,
  now = () => 1_000) {
  return new OwnerElevenLabsStsOriginalReferenceService({ ffprobePath, destination: "hidden", binding: BINDING, linkService, resolveClient, now });
}

test("STS original service requires genuine PerUserLinkService state before probing or resolving a client", async () => {
  const fixture = await ffprobeFixture();
  const clone = Object.create(PerUserLinkService.prototype) as PerUserLinkService;
  let lookups = 0;
  const service = createService(fixture.binary, clone, () => { lookups++; return null; });
  try {
    await assert.rejects(() => service.uploadOriginal({ attemptId: ATTEMPT, filename: "source.mp3", mime_type: "audio/mpeg", bytes: MP3 }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(lookups, 0);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("genuine STS probe uploads once and resolves only a branded same-client typed audio witness", async () => {
  const fixture = await ffprobeFixture();
  const linkService = await createLinkedOwners([ATTEMPT]);
  let uploads = 0;
  const client = successClient(() => { uploads++; });
  const service = createService(fixture.binary, linkService, () => client);
  try {
    const inputBytes = new Uint8Array(MP3);
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT, filename: "source.mp3", mime_type: "audio/mpeg", bytes: inputBytes });
    assert.deepEqual(inputBytes, MP3, "the caller retains its bytes");
    assert.equal(uploads, 1);
    assert.deepEqual(receipt, { status: "uploaded", audio_original_handle: receipt.audio_original_handle,
      sha256: receipt.sha256, size: MP3.byteLength, mime_type: "audio/mpeg", duration_seconds: 11.006259, expires_in_seconds: 900 });
    assert.match(receipt.audio_original_handle, /^elevenlabs_sts_original_[0-9a-f-]{36}$/u);
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(receipt).includes(UPLOAD_URL), false);
    assert.equal(JSON.stringify(receipt).includes("source.mp3"), false);
    const context = { attempt_id: ATTEMPT, audio_original_handle: receipt.audio_original_handle };
    const resolution = await service.resolveOriginal(context);
    assert.equal(resolution.wire_type, "audio");
    assert.equal(resolution.model_type, "eleven_multilingual_sts_v2");
    assert.equal(service.isOwnedOriginalResolution(resolution, context), true);
    assert.equal(service.isOwnedOriginalResolution({ ...resolution }, context), false);
    const capturedReference = service.withCapturedNativeOriginal(resolution, context, (_capturedClient, reference) => reference);
    const captured = { capturedClient: client, witness: readOwnerElevenLabsStsOriginalUploadForClient(client, capturedReference) };
    assert.equal(captured.capturedClient, client);
    assert.equal(captured.witness?.url, UPLOAD_URL);
    assert.equal(captured.witness?.model_type, "eleven_multilingual_sts_v2");
    await service.invalidateAttempt(ATTEMPT);
    assert.equal(service.isOwnedOriginalResolution(resolution, context), false);
    assert.equal(readOwnerElevenLabsStsOriginalUploadForClient(client, capturedReference)?.url, UPLOAD_URL);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("STS native upload UNKNOWN is suppressed across attempts and fresh probes for the same owner bytes", async () => {
  const fixture = await ffprobeFixture();
  const links = await createLinkedOwners([ATTEMPT, OTHER_ATTEMPT]);
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { posts++; throw new Error("synthetic disconnect"); } });
  const service = createService(fixture.binary, links, () => client);
  const input = { filename: "source.mp3", mime_type: "audio/mpeg", bytes: MP3 };
  try {
    await assert.rejects(() => service.uploadOriginal({ ...input, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(() => service.uploadOriginal({ ...input, attemptId: OTHER_ATTEMPT }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("foreign handles are unavailable and close drains service state without revoking the native upload witness", async () => {
  const fixture = await ffprobeFixture();
  const linkService = await createLinkedOwners([ATTEMPT]);
  const client = successClient();
  const service = createService(fixture.binary, linkService, () => client);
  try {
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT, filename: "source.mp3", mime_type: "audio/mpeg", bytes: MP3 });
    const foreign = { attempt_id: ATTEMPT, audio_original_handle: "elevenlabs_sts_original_00000000-0000-4000-8000-000000000000" };
    await assert.rejects(() => service.resolveOriginal(foreign),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    const context = { attempt_id: ATTEMPT, audio_original_handle: receipt.audio_original_handle };
    const resolution = await service.resolveOriginal(context);
    const capturedReference = service.withCapturedNativeOriginal(resolution, context, (_client, reference) => reference);
    await service.close();
    assert.equal(service.isOwnedOriginalResolution(resolution, context), false);
    assert.equal(readOwnerElevenLabsStsOriginalUploadForClient(client, capturedReference)?.url, UPLOAD_URL);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
