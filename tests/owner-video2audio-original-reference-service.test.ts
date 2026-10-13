import assert from "node:assert/strict";
import { SyntxChatHttpClient, isOwnerVideo2AudioOriginalReferenceForClient, readOwnerVideo2AudioOriginalReferenceForClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";
import test from "node:test";

const SERVICE_MODULE_URL = new URL("../src/application/owner-video2audio-original-reference-service.js", import.meta.url).href;
const serviceModule = await import(SERVICE_MODULE_URL).catch(() => null) as Record<string, unknown> | null;

const ATTEMPT = "link_video2audio_original_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "video2audio-original-tenant", subject: "video2audio-original-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const UPLOAD_URL = "https://r2.syntx.ai/video2audio/private-original.mp4";
const PROFILE = createOwnerVideo2AudioSourceProfile();
const FOREIGN_ATTEMPT = "link_video2audio_original_foreign_0123456789";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-video2audio-owner-credential"); } };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

async function createLinkedOwnerLinkService(attemptIds: readonly string[] = [ATTEMPT], now = () => 1_000, defaultTtlMs = 5 * 60_000) {
  let nextAttemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${attemptIds[nextAttemptIndex - 1]}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_upstreamAttemptId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-video2audio-owner-token" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(now);
  const linkService = new PerUserLinkService(provider, store, { now, defaultTtlMs, attemptIdGenerator: () => attemptIds[nextAttemptIndex++]! });
  const attemptId = attemptIds[0]!;
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, attemptId);
  await linkService.checkAttempt(BINDING, attemptId);
  return linkService;
}

test("Video2Audio owned-original service has a dedicated application lifecycle", () => {
  assert.ok(serviceModule, "MISSING_OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCE_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerVideo2AudioOriginalReferenceService, "function",
    "MISSING_OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCE_SERVICE");
});

test("upload issues a URL-free handle and resolves only its genuine owner-bound native witness", async () => {
  let time = 1_000, statusReads = 0, fetchCalls = 0;
  const now = () => time;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT], now);
  const nativeGetStatus = linkService.getStatus.bind(linkService);
  linkService.getStatus = async (binding, attemptId) => { statusReads += 1; return nativeGetStatus(binding, attemptId); };
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "video2audio");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), MP4);
    return response({ total: 1, successful: 1, failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL,
      status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64, width: 1280, height: 720,
      hash: "opaque-provider-hash", uuid: "opaque-provider-id", inert_metadata: { ignored: true } }] });
  } });
  const Service = serviceModule?.OwnerVideo2AudioOriginalReferenceService as (new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<Record<string, unknown>>;
    isOwnedOriginalResolution(value: unknown, input: unknown): boolean;
    getNativeReference(value: unknown, client: unknown): unknown;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCE_SERVICE");
  const service = new Service!({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now });
  let borrowedNativeReference: unknown;
  try {
    const inputBytes = new Uint8Array(MP4);
    const original = new Uint8Array(inputBytes);
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: inputBytes });
    assert.deepEqual(inputBytes, original, "the caller retains ownership of input bytes");
    assert.equal(fetchCalls, 1);
    assert.equal(statusReads, 2, "owner is re-read both before and after the one native POST");
    assert.equal(receipt.status, "uploaded");
    assert.match(String(receipt.video_original_handle), /^video2audio_original_[0-9a-f-]{36}$/u);
    assert.equal(receipt.mime_type, "video/mp4");
    assert.equal(receipt.size, MP4.byteLength);
    assert.equal(receipt.duration_seconds, 5.64);
    assert.equal(receipt.expires_in_seconds, 900);
    for (const privateValue of [UPLOAD_URL, "opaque-provider-hash", "opaque-provider-id", "original.mp4", Buffer.from(MP4).toString("base64")]) {
      assert.equal(JSON.stringify(receipt).includes(privateValue), false);
    }
    const context = { attempt_id: ATTEMPT, video_original_handle: receipt.video_original_handle };
    const resolution = await service.resolveOriginal(context);
    assert.equal(statusReads, 4, "resolve checks current principal before and after reading the native witness");
    assert.equal(service.isOwnedOriginalResolution(resolution, context), true);
    assert.equal(JSON.stringify(resolution).includes(UPLOAD_URL), false);
    borrowedNativeReference = service.getNativeReference(resolution, client);
    assert.equal(isOwnerVideo2AudioOriginalReferenceForClient(client, PROFILE, borrowedNativeReference), true);
    assert.deepEqual(readOwnerVideo2AudioOriginalReferenceForClient(client, PROFILE, borrowedNativeReference), {
      status: "OWNER_VIDEO2AUDIO_ORIGINAL_UPLOADED", profile_schema_hash: PROFILE.profileSchemaHash,
      sha256: receipt.sha256, mime_type: "video/mp4", size: MP4.byteLength, duration_seconds: 5.64, url: UPLOAD_URL
    });
  } finally { await service.close(); }
  assert.equal(isOwnerVideo2AudioOriginalReferenceForClient(client, PROFILE, borrowedNativeReference), true,
    "closing the original handle service must not close a borrowed runtime-owned native client");
});

test("rejects caller URL, duration, model selectors, MIME aliases, and malformed MP4 before auth/upload", async () => {
  let now = 1_000, statusReads = 0, fetchCalls = 0, credentialCalls = 0;
  const nowFn = () => now;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT], nowFn);
  const getStatus = linkService.getStatus.bind(linkService);
  linkService.getStatus = async (binding, attemptId) => { statusReads += 1; return getStatus(binding, attemptId); };
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentialCalls += 1; return operation("synthetic-no-network-owner-token");
  } }, fetchImpl: async () => { fetchCalls += 1; return response({}); } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>; close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now: nowFn });
  try {
    const base = { attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 };
    for (const invalid of [
      { ...base, url: UPLOAD_URL }, { ...base, duration_seconds: 5.64 }, { ...base, model_type: "video2audio" },
      { ...base, mime_type: "video/quicktime" }, { ...base, filename: "../original.mp4" },
      { ...base, bytes: Uint8Array.from([1, 2, 3]) }
    ]) {
      await assert.rejects(() => service.uploadOriginal(invalid), (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    }
    const forgedProfile = { ...PROFILE };
    assert.throws(() => new Service({ profile: forgedProfile, binding: BINDING, linkService, resolveClient: () => client, now: nowFn }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");
    assert.equal(statusReads, 0);
    assert.equal(credentialCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally { await service.close(); }
});

test("a foreign linked attempt cannot resolve or revoke an owner's original handle", async () => {
  let fetchCalls = 0;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT, FOREIGN_ATTEMPT]);
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, FOREIGN_ATTEMPT);
  await linkService.checkAttempt(BINDING, FOREIGN_ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    fetchCalls += 1;
    return response({ total: 1, successful: 1, failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL,
      status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
  } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<Record<string, unknown>>;
    isOwnedOriginalResolution(value: unknown, input: unknown): boolean;
    close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now: () => 2_000 });
  try {
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const ownerContext = { attempt_id: ATTEMPT, video_original_handle: receipt.video_original_handle };
    const resolution = await service.resolveOriginal(ownerContext);
    await assert.rejects(() => service.resolveOriginal({ attempt_id: FOREIGN_ATTEMPT, video_original_handle: receipt.video_original_handle }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(service.isOwnedOriginalResolution(resolution, ownerContext), true);
    const ownerAgain = await service.resolveOriginal(ownerContext);
    assert.equal(service.isOwnedOriginalResolution(ownerAgain, ownerContext), true);
    assert.equal(fetchCalls, 1, "resolution and foreign-attempt denial do not upload again");
  } finally { await service.close(); }
});

test("a known original keeps its captured upload client across resolver rotation; a wrong client is denied without revocation", async () => {
  const linkService = await createLinkedOwnerLinkService([ATTEMPT]);
  let ownerPosts = 0, rotatedPosts = 0;
  const ownerClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    ownerPosts += 1;
    return response({ total: 1, successful: 1, failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL,
      status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
  } });
  const rotatedClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    rotatedPosts += 1;
    throw new Error("wrong-client access must never upload");
  } });
  let currentClient: SyntxChatHttpClient = ownerClient;
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<Record<string, unknown>>;
    getNativeReference(value: unknown, client: unknown): unknown;
    withCapturedNativeOriginal<T>(value: unknown, input: unknown, consume: (client: unknown, reference: unknown) => T): T;
    isOwnedOriginalResolution(value: unknown, input: unknown): boolean;
    close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => currentClient, now: () => 2_500 });
  try {
    const receipt = await service.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const context = { attempt_id: ATTEMPT, video_original_handle: receipt.video_original_handle };
    currentClient = rotatedClient;
    const resolution = await service.resolveOriginal(context);
    assert.throws(() => service.getNativeReference(resolution, rotatedClient),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(service.isOwnedOriginalResolution(resolution, context), true, "wrong-client access does not revoke the valid handle");
    const pair = service.withCapturedNativeOriginal(resolution, context, (client, reference) => ({ client, reference }));
    assert.equal(pair.client, ownerClient, "generation must reuse the exact upload client, not a fresh resolver result");
    assert.equal(service.getNativeReference(resolution, ownerClient), pair.reference);
    assert.equal(ownerPosts, 1);
    assert.equal(rotatedPosts, 0);
  } finally { await service.close(); }
});

test("known handles expire after 15 minutes and late upload receipts never mint a stale handle", async () => {
  let time = 4_000, posts = 0;
  const now = () => time;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT], now, 30 * 60_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    if (posts === 2) time += 15 * 60_000;
    return response({ total: 1, successful: 1, failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL,
      status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
  } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now });
  try {
    const uploaded = await service.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    time += 15 * 60_000;
    await assert.rejects(() => service.resolveOriginal({ attempt_id: ATTEMPT, video_original_handle: uploaded.video_original_handle }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED");
    await assert.rejects(() => service.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 2);
    assert.equal(typeof uploaded.video_original_handle, "string", "late ACK cannot return a stale new handle");
  } finally { await service.close(); }
});

test("attempt invalidation aborts and drains the native upload, retaining the no-replay UNKNOWN hold", async () => {
  let posts = 0, markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const linkService = await createLinkedOwnerLinkService([ATTEMPT]);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    posts += 1;
    markStarted();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(new Error("synthetic aborted upload")); return; }
      signal?.addEventListener("abort", () => reject(new Error("synthetic aborted upload")), { once: true });
    });
  } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>; invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now: () => 5_000 });
  const input = { attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 };
  try {
    const upload = service.uploadOriginal(input);
    await started;
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => upload, (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(() => service.uploadOriginal(input), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("service close aborts and drains its pending upload without closing the borrowed native client", async () => {
  let posts = 0, markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const linkService = await createLinkedOwnerLinkService([ATTEMPT]);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    posts += 1;
    markStarted();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(new Error("synthetic aborted upload")); return; }
      signal?.addEventListener("abort", () => reject(new Error("synthetic aborted upload")), { once: true });
    });
  } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>; close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now: () => 5_500 });
  const upload = service.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
  await started;
  await service.close();
  await assert.rejects(() => upload, (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(posts, 1);
  assert.equal(client instanceof SyntxChatHttpClient, true, "service close does not close or destroy its borrowed native client");
});

test("unknown upload claims survive 16 minutes and 128 holds cannot be evicted to make room", async () => {
  let time = 1_000, posts = 0;
  const now = () => time;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT], now, 30 * 60_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    throw new Error("synthetic lost upload acknowledgement");
  } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>;
    close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now });
  const uploadInput = (marker: number) => {
    const bytes = new Uint8Array(MP4);
    bytes[bytes.length - 1] = marker;
    return { attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes };
  };
  try {
    for (let index = 1; index <= 128; index += 1) {
      await assert.rejects(() => service.uploadOriginal(uploadInput(index)), (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    }
    await assert.rejects(() => service.uploadOriginal(uploadInput(129)), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "CAPACITY_EXCEEDED");
    assert.equal(posts, 128, "the 129th upload is rejected before its sole native POST");

    time += 16 * 60_000;
    await assert.rejects(() => service.uploadOriginal(uploadInput(1)), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 128, "an uncertain upload is not replayed after the upload-handle TTL interval");
  } finally { await service.close(); }
});

test("an UNKNOWN upload is not replayed under a fresh link attempt for the same owner and file", async () => {
  let posts = 0;
  const linkService = await createLinkedOwnerLinkService([ATTEMPT, FOREIGN_ATTEMPT]);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1;
    throw new Error("synthetic lost upload acknowledgement");
  } });
  const Service = serviceModule!.OwnerVideo2AudioOriginalReferenceService as new (options: unknown) => {
    uploadOriginal(input: unknown): Promise<unknown>; close(): Promise<void>;
  };
  const service = new Service({ profile: PROFILE, binding: BINDING, linkService, resolveClient: () => client, now: () => 6_000 });
  const input = { filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 };
  try {
    await assert.rejects(() => service.uploadOriginal({ ...input, attemptId: ATTEMPT }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await linkService.createAttempt(BINDING);
    await linkService.issueHandoff(BINDING, FOREIGN_ATTEMPT);
    await linkService.checkAttempt(BINDING, FOREIGN_ATTEMPT);
    await assert.rejects(() => service.uploadOriginal({ ...input, attemptId: FOREIGN_ATTEMPT }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1, "semantic UNKNOWN hold excludes attempt/link nonce and prevents another native POST");
  } finally { await service.close(); }
});
