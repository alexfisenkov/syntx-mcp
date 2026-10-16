import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient, readOwnerFlux3UploadReferenceForClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import {
  OwnerFlux3MediaReferenceService,
  OwnerFlux3MediaReferenceServiceError
} from "../src/application/owner-flux3-media-reference-service.js";

const ATTEMPT_A = "link_flux3_owner_0123456789abcdef";
const ATTEMPT_B = "link_flux3_owner_fedcba9876543210";
const BINDING = Object.freeze({ tenant_id: "flux3-test-tenant", subject: "flux3-test-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const IMAGE_URL = "https://r2.syntx.ai/flux3-i2v/hidden/scene.png";
const VIDEO_URL = "https://r2.syntx.ai/flux3-v2v/hidden/original.mp4";
const VIDEO_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "unlistedcodec", width: 7680, height: 4320, duration: "240.5", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "unlistedaudio" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "240.8" }
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

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-flux3-reference-credential");
  } };
}

async function linkedOwners(attemptIds: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-linked-owner-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now,
    attemptIdGenerator: () => attemptIds[next++]!
  });
  for (const attemptId of attemptIds) {
    await links.createAttempt(BINDING);
    await links.issueHandoff(BINDING, attemptId);
    await links.checkAttempt(BINDING, attemptId);
  }
  return links;
}

async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-reference-2012-"));
  const binary = join(directory, "ffprobe-fixture");
  const program = `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst fs = require("node:fs");\n` +
    `if (args.includes("-count_frames")) process.exit(41);\nfor (const arg of args) if (arg.endsWith("/source.mp4")) { if (!fs.statSync(arg).isFile()) process.exit(42); }\n` +
    `process.stdout.write(${JSON.stringify(VIDEO_PROBE)});\n`;
  await writeFile(binary, program, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

type Service = Pick<OwnerFlux3MediaReferenceService,
  "uploadReference" | "resolveReference" | "isOwnedReferenceResolution" | "withCapturedNativeReference" | "invalidateAttempt" | "close">;

function makeService(options: Record<string, unknown>): Service {
  return new OwnerFlux3MediaReferenceService(options);
}

function imageInput(attemptId = ATTEMPT_A) {
  return { attemptId, model_id: "flux3_i2v", filename: "scene.png", mime_type: "image/png", bytes: new Uint8Array(PNG) };
}

function videoInput(attemptId = ATTEMPT_A, bytes = mp4Bytes()) {
  return { attemptId, model_id: "flux3_v2v", filename: "original.mp4", mime_type: "video/mp4", bytes };
}

test("one-at-a-time I2V/V2V uploads yield opaque owner-bound handles and URL-free role-specific resolutions", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const now = () => 1_000;
  const links = await linkedOwners([ATTEMPT_A], now);
  let posts = 0;
  let fetchFailure: unknown;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    posts += 1;
    try {
      const form = init?.body as FormData;
      const modelId = form.get("model_type");
      assert.equal(form.get("check_duplicates"), "true");
      const file = form.get("files");
      assert.ok(file instanceof File);
      if (modelId === "flux3_i2v") {
        assert.equal(form.get("destination"), "hidden");
        assert.equal(file.name, "scene.png");
        assert.equal(file.type, "image/png");
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
        return response({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success", size: PNG.byteLength, content_type: "image/png" }] });
      }
      assert.equal(modelId, "flux3_v2v");
      assert.equal(form.get("destination"), "hidden");
      assert.equal(file.name, "original.mp4");
      assert.equal(file.type, "video/mp4");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), mp4Bytes());
      return response({ files: [{ url: VIDEO_URL, filename: "original.mp4", status: "success", size: 28, content_type: "video/mp4" }] });
    } catch (error) {
      fetchFailure = error;
      throw error;
    }
  } });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now });
  try {
    let imageReceipt;
    try { imageReceipt = await service.uploadReference(imageInput()); }
    catch (error) { if (fetchFailure) throw fetchFailure; throw error; }
    const videoReceipt = await service.uploadReference(videoInput());
    assert.equal(posts, 2);
    assert.match(imageReceipt.flux3_reference_handle, /^flux3_media_reference_[0-9a-f-]{36}$/u);
    assert.match(videoReceipt.flux3_reference_handle, /^flux3_media_reference_[0-9a-f-]{36}$/u);
    assert.equal(imageReceipt.model_id, "flux3_i2v");
    assert.equal(videoReceipt.model_id, "flux3_v2v");
    assert.equal(imageReceipt.duration_seconds, null);
    assert.equal(videoReceipt.duration_seconds, 240.5);
    assert.equal(JSON.stringify(imageReceipt).includes(IMAGE_URL), false);
    assert.equal(JSON.stringify(videoReceipt).includes(VIDEO_URL), false);

    const imageResolution = await service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_i2v",
      flux3_reference_handle: imageReceipt.flux3_reference_handle });
    const videoResolution = await service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_v2v",
      flux3_reference_handle: videoReceipt.flux3_reference_handle });
    assert.equal(imageResolution.role, "flux3_media_reference");
    assert.equal(imageResolution.wire_type, "image");
    assert.equal(imageResolution.generation_permit, false);
    assert.equal(imageResolution.duration_seconds, null);
    assert.equal(videoResolution.wire_type, "video");
    assert.equal(videoResolution.generation_permit, false);
    assert.equal(videoResolution.duration_seconds, 240.5);
    assert.equal("url" in imageResolution, false);
    assert.equal("url" in videoResolution, false);
    assert.equal(JSON.stringify(imageResolution).includes(IMAGE_URL), false);
    assert.equal(JSON.stringify(videoResolution).includes(VIDEO_URL), false);
    assert.equal(service.isOwnedReferenceResolution(imageResolution), true);
    assert.equal(service.isOwnedReferenceResolution(videoResolution), true);
    assert.equal(service.withCapturedNativeReference(imageResolution, (capturedClient, context) =>
      readOwnerFlux3UploadReferenceForClient(capturedClient, context)?.url), IMAGE_URL);
    assert.equal(service.withCapturedNativeReference(videoResolution, (capturedClient, context) =>
      readOwnerFlux3UploadReferenceForClient(capturedClient, context)?.url), VIDEO_URL);
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_v2v",
      flux3_reference_handle: imageReceipt.flux3_reference_handle }), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("client replacement before upload prevents POST and replacement after POST yields no handle", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  let posts = 0;
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    return response({ files: [{ url: VIDEO_URL, filename: "original.mp4", status: "success", size: 28, content_type: "video/mp4" }] });
  } });
  const replacementClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("replacement must not be used"); } });
  let beforeCalls = 0;
  const before = makeService({ binding: BINDING, linkService: links,
    resolveClient: () => ++beforeCalls === 1 ? uploadClient : replacementClient, ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  try {
    await assert.rejects(before.uploadReference(videoInput(ATTEMPT_A)), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(posts, 0);
  } finally { await before.close(); }

  let afterCalls = 0;
  const after = makeService({ binding: BINDING, linkService: links,
    resolveClient: () => ++afterCalls <= 2 ? uploadClient : replacementClient, ffprobePath: fixture.binary, destination: "hidden", now: () => 2_000 });
  try {
    await assert.rejects(after.uploadReference(videoInput(ATTEMPT_B)), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await after.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("ambiguous upload tombstone blocks replay of identical owner/model/content on another attempt", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    throw new Error("synthetic transport interruption after possible POST");
  } });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  try {
    await assert.rejects(service.uploadReference(videoInput(ATTEMPT_A)), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.uploadReference(videoInput(ATTEMPT_B)), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("a busy duplicate cannot clear another pending request's semantic reservation", async () => {
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  let notifyFirstPost!: () => void;
  const firstPost = new Promise<void>((resolve) => { notifyFirstPost = resolve; });
  let releaseFirstPost!: (result: Response) => void;
  const heldFirstResponse = new Promise<Response>((resolve) => { releaseFirstPost = resolve; });
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    if (posts === 1) { notifyFirstPost(); return heldFirstResponse; }
    return response({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success", size: PNG.byteLength, content_type: "image/png" }] });
  } });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: "/unused-for-image-upload", destination: "uploaded", now: () => 1_000 });
  const first = service.uploadReference(imageInput(ATTEMPT_A));
  try {
    await firstPost;
    for (let duplicate = 0; duplicate < 2; duplicate += 1) {
      await assert.rejects(service.uploadReference(imageInput(ATTEMPT_B)), (error: unknown) =>
        error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "SERVICE_BUSY");
      assert.equal(posts, 1, `duplicate ${duplicate + 1} must not dispatch while first request is pending`);
    }
    releaseFirstPost(response({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success",
      size: PNG.byteLength, content_type: "image/png" }] }));
    const receipt = await first;
    assert.equal(receipt.status, "uploaded");
    assert.equal(posts, 1);
  } finally {
    releaseFirstPost(response({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success",
      size: PNG.byteLength, content_type: "image/png" }] }));
    await first.catch(() => undefined);
    await service.close();
  }
});

test("15-minute TTL revokes opaque references", async () => {
  let now = 1_000;
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () =>
    response({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success", size: PNG.byteLength, content_type: "image/png" }] }) });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: "/unused-for-image-upload", destination: "uploaded", now: () => now });
  try {
    const receipt = await service.uploadReference(imageInput());
    assert.equal(receipt.expires_in_seconds, 900);
    const resolution = await service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_i2v",
      flux3_reference_handle: receipt.flux3_reference_handle });
    assert.equal(service.isOwnedReferenceResolution(resolution), true);
    now = 901_000;
    assert.equal(service.isOwnedReferenceResolution(resolution), false);
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_i2v",
      flux3_reference_handle: receipt.flux3_reference_handle }), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); }
});

test("attempt invalidation revokes existing handles before a fresh resolve or capture", async () => {
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () =>
    response({ files: [{ url: IMAGE_URL, filename: "scene.png", status: "success", size: PNG.byteLength, content_type: "image/png" }] }) });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: "/unused-for-image-upload", destination: "uploaded", now: () => 1_000 });
  try {
    const receipt = await service.uploadReference(imageInput());
    const resolution = await service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_i2v",
      flux3_reference_handle: receipt.flux3_reference_handle });
    await service.invalidateAttempt(ATTEMPT_A);
    assert.equal(service.isOwnedReferenceResolution(resolution), false);
    assert.throws(() => service.withCapturedNativeReference(resolution, () => "must not run"),
      (error: unknown) => error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_i2v",
      flux3_reference_handle: receipt.flux3_reference_handle }), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); }
});

test("close aborts and drains an in-flight native upload without returning a handle", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture executable unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  let notifyStarted!: () => void;
  const postStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    posts += 1;
    notifyStarted();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  } });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  const upload = service.uploadReference(videoInput());
  try {
    await postStarted;
    const closing = service.close();
    await assert.rejects(upload, (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await closing;
    assert.equal(posts, 1);
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_A, model_id: "flux3_v2v",
      flux3_reference_handle: "flux3_media_reference_00000000-0000-4000-8000-000000000000" }), (error: unknown) =>
      error instanceof OwnerFlux3MediaReferenceServiceError && error.code === "SERVICE_CLOSED");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
