import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient, readOwnerTopazEnhanceOriginalUploadForClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";

const SERVICE_MODULE_URL = new URL("../src/application/owner-topaz-enhance-original-reference-service.js", import.meta.url).href;
const serviceModule = await import(SERVICE_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT_A = "link_topaz_enhance_owner_0123456789";
const ATTEMPT_B = "link_topaz_enhance_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "topaz-enhance-tenant", subject: "topaz-enhance-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x31, 0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);
const UPLOAD_URL = "https://r2.syntx.ai/topaz-enhance/hidden/original.mp4";
const PROBE_JSON = JSON.stringify({ streams: [
  { codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "90", duration: "3.000000", disposition: { attached_pic: 0 } },
  { codec_type: "audio", codec_name: "aac", duration: "3.000000" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000" } });

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-service-1980-"));
  const binary = join(directory, "ffprobe-fixture");
  await writeFile(binary, `#!/bin/sh\nprintf '%s' ${shellQuote(PROBE_JSON)}\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-topaz-enhance-owner-credential"); } };
}
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
async function linkedOwners(attemptIds: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => attemptIds[next++]! });
  for (const attemptId of attemptIds) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId); }
  return links;
}
function createService(options: Record<string, unknown>): {
  uploadOriginal(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  resolveOriginal(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  isOwnedOriginalResolution(value: unknown, input: unknown): boolean;
  withCapturedNativeOriginal<T>(value: unknown, input: unknown, consume: (client: unknown, reference: unknown) => T): T;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
} {
  const Service = serviceModule?.OwnerTopazEnhanceOriginalReferenceService as (new (input: unknown) => ReturnType<typeof createService>) | undefined;
  if (!Service) throw new Error("SERVICE_MODULE_MISSING");
  return new Service(options);
}

test("Topaz Enhance owner reference service module is present with the native capture API", () => {
  assert.ok(serviceModule, "MISSING_OWNER_TOPAZ_ENHANCE_ORIGINAL_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerTopazEnhanceOriginalReferenceService, "function");
  for (const exported of ["OwnerTopazEnhanceOriginalReferenceServiceError"]) {
    assert.equal(typeof serviceModule[exported], "function", `missing export ${exported}`);
  }
});

test("trusted owner upload yields an opaque handle, owned resolution, and callback-scoped URL", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const now = () => 1_000;
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], now);
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    posts += 1;
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/chats/upload-files");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "topaz_enhance");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), MP4);
    return response({ files: [{ filename: "source.mp4", url: UPLOAD_URL, status: "success", size: MP4.byteLength,
      content_type: "video/mp4", duration: 3 }] });
  } });
  const service = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => client, now });
  try {
    const source = new Uint8Array(MP4);
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT_A, model_id: "topaz_enhance", filename: "source.mp4",
      mime_type: "video/mp4", bytes: source });
    assert.deepEqual(source, MP4, "caller bytes remain unchanged");
    assert.equal(posts, 1);
    assert.equal(receipt.status, "uploaded");
    assert.match(String(receipt.topaz_original_handle), /^topaz_enhance_original_[0-9a-f-]{36}$/u);
    assert.equal(receipt.width, 640);
    assert.equal(receipt.height, 360);
    assert.equal(receipt.duration_seconds, 3);
    assert.equal(receipt.frame_count, 90);
    assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(JSON.stringify(receipt).includes(UPLOAD_URL), false);
    const context = { attempt_id: ATTEMPT_A, topaz_original_handle: receipt.topaz_original_handle };
    const resolution = await service.resolveOriginal(context);
    assert.equal(resolution.role, "topaz_enhance_original");
    assert.equal(resolution.generation_permit, false);
    assert.equal(service.isOwnedOriginalResolution(resolution, context), true);
    await assert.rejects(service.resolveOriginal({ attempt_id: ATTEMPT_B, topaz_original_handle: receipt.topaz_original_handle }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    const captured = service.withCapturedNativeOriginal(resolution, context, (capturedClient, nativeContext) => ({ capturedClient, nativeContext }));
    assert.equal(captured.capturedClient, client);
    const ownedNative = readOwnerTopazEnhanceOriginalUploadForClient(captured.capturedClient, captured.nativeContext);
    assert.equal(ownedNative?.url, UPLOAD_URL);
    assert.equal(JSON.stringify(resolution).includes(UPLOAD_URL), false);
    await service.invalidateAttempt(ATTEMPT_A);
    assert.equal(service.isOwnedOriginalResolution(resolution, context), false);
    await assert.rejects(service.resolveOriginal(context), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("binds the same client before and after upload; a client change never yields a usable handle", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  let posts = 0;
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    return response({ files: [{ filename: "source.mp4", url: UPLOAD_URL, status: "success", size: MP4.byteLength,
      content_type: "video/mp4", duration: 3 }] });
  } });
  const replacementClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("must not post to replacement"); } });
  let beforeCalls = 0;
  const beforeService = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => ++beforeCalls === 1 ? uploadClient : replacementClient, now: () => 1_000 });
  try {
    await assert.rejects(beforeService.uploadOriginal({ attemptId: ATTEMPT_A, model_id: "topaz_enhance", filename: "source.mp4",
      mime_type: "video/mp4", bytes: MP4 }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(posts, 0, "the client is checked again after the async probe and before POST");
  } finally { await beforeService.close(); }

  let afterCalls = 0;
  const afterService = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => ++afterCalls <= 2 ? uploadClient : replacementClient, now: () => 2_000 });
  try {
    await assert.rejects(afterService.uploadOriginal({ attemptId: ATTEMPT_B, model_id: "topaz_enhance", filename: "source.mp4",
      mime_type: "video/mp4", bytes: MP4 }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "a changed client after native POST makes the outcome unknown and grants no handle");
  } finally { await afterService.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("unknown native upload outcome is fenced across link attempts without replay", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { posts += 1; throw new Error("synthetic disconnect"); } });
  const service = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => client, now: () => 1_000 });
  try {
    const source = { model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: MP4 };
    await assert.rejects(service.uploadOriginal({ attemptId: ATTEMPT_A, ...source }), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.uploadOriginal({ attemptId: ATTEMPT_B, ...source }), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "the same owner/model/content semantic intent is not replayed by a second link attempt");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("rejects a DTO-shaped fake link service before client resolution or probing", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  let clientLookups = 0;
  try {
    assert.throws(() => createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING,
      linkService: { async getStatus() { return { linked: true }; } }, resolveClient: () => { clientLookups += 1; return null; } }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.equal(clientLookups, 0);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("close aborts and drains an in-flight native upload before completing", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  let notifyStarted!: () => void;
  const postStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
  let postCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    postCount += 1;
    notifyStarted();
    const signal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  } });
  const service = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => client, now: () => 1_000 });
  const upload = service.uploadOriginal({ attemptId: ATTEMPT_A, model_id: "topaz_enhance", filename: "source.mp4",
    mime_type: "video/mp4", bytes: MP4 });
  try {
    await postStarted;
    const closing = service.close();
    await assert.rejects(upload, (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await closing;
    assert.equal(postCount, 1);
    await assert.rejects(service.resolveOriginal({ attempt_id: ATTEMPT_A, topaz_original_handle: "topaz_enhance_original_00000000-0000-4000-8000-000000000000" }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_CLOSED");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("expires a genuine reference at its 15-minute TTL without leaking its native URL", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  let now = 1_000;
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () =>
    response({ files: [{ filename: "source.mp4", url: UPLOAD_URL, status: "success", size: MP4.byteLength,
      content_type: "video/mp4", duration: 3 }] }) });
  const service = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => client, now: () => now });
  try {
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT_A, model_id: "topaz_enhance", filename: "source.mp4",
      mime_type: "video/mp4", bytes: MP4 });
    assert.equal(receipt.expires_in_seconds, 900);
    const resolveInput = { attempt_id: ATTEMPT_A, topaz_original_handle: receipt.topaz_original_handle };
    const stillLive = await service.resolveOriginal(resolveInput);
    assert.equal(service.isOwnedOriginalResolution(stillLive, resolveInput), true);
    now = 901_000;
    assert.equal(service.isOwnedOriginalResolution(stillLive, resolveInput), false);
    await assert.rejects(service.resolveOriginal(resolveInput), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("revokes ownership and captured native access when resolveClient switches after resolution", async (t) => {
  if (!serviceModule) { t.skip("service implementation not present before this test's TDD RED"); return; }
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  const firstClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () =>
    response({ files: [{ filename: "source.mp4", url: UPLOAD_URL, status: "success", size: MP4.byteLength,
      content_type: "video/mp4", duration: 3 }] }) });
  const replacementClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("replacement must not be used"); } });
  let currentClient = firstClient;
  const service = createService({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => currentClient, now: () => 1_000 });
  try {
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT_A, model_id: "topaz_enhance", filename: "source.mp4",
      mime_type: "video/mp4", bytes: MP4 });
    const request = { attempt_id: ATTEMPT_A, topaz_original_handle: receipt.topaz_original_handle };
    const resolution = await service.resolveOriginal(request);
    assert.equal(service.isOwnedOriginalResolution(resolution, request), true);
    currentClient = replacementClient;
    assert.equal(service.isOwnedOriginalResolution(resolution, request), false);
    let callbackCalled = false;
    assert.throws(() => service.withCapturedNativeOriginal(resolution, request, () => { callbackCalled = true; }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(callbackCalled, false);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
