import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerVideo2AudioOriginalReferenceService } from "../src/application/owner-video2audio-original-reference-service.js";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";

const MODULE_URL = new URL("../src/application/owner-video2audio-request-preparer.js", import.meta.url).href;
const preparerModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const INPUT_MODULE_URL = new URL("../src/application/owner-video2audio-input-parameters.js", import.meta.url).href;
const inputModule = await import(INPUT_MODULE_URL) as Record<string, unknown>;
const ONE_SHOT_MODULE_URL = new URL("../src/application/owner-video2audio-one-shot-policy.js", import.meta.url).href;
const oneShotModule = await import(ONE_SHOT_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_video2audio_preparer_owner_0123456789";
const FOREIGN_ATTEMPT = "link_video2audio_preparer_foreign_9876543210";
const BINDING = Object.freeze({ tenant_id: "video2audio-preparer-tenant", subject: "video2audio-preparer-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const UPLOAD_URL = "https://r2.syntx.ai/video2audio/preparer-original.mp4";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-video2audio-preparer-credential"); } };
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function linkedService(attemptIds: readonly string[] = [ATTEMPT], now = () => 1_000, defaultTtlMs = 5 * 60_000) {
  let nextAttemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${attemptIds[nextAttemptIndex - 1]}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-video2audio-preparer-token" });
      return { state: "LINKED" };
    }
  };
  const service = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now),
    { now, defaultTtlMs, attemptIdGenerator: () => attemptIds[nextAttemptIndex++]! });
  await service.createAttempt(BINDING);
  await service.issueHandoff(BINDING, attemptIds[0]!);
  await service.checkAttempt(BINDING, attemptIds[0]!);
  return service;
}

test("Video2Audio request preparer exposes a genuine factory and candidate type guard", () => {
  assert.ok(preparerModule, "MISSING_OWNER_VIDEO2AUDIO_REQUEST_PREPARER_MODULE");
  assert.equal(typeof preparerModule.createOwnerVideo2AudioRequestPreparer, "function",
    "MISSING_OWNER_VIDEO2AUDIO_REQUEST_PREPARER_FACTORY");
  assert.equal(typeof preparerModule.isOwnerVideo2AudioPreparedCandidate, "function",
    "MISSING_OWNER_VIDEO2AUDIO_CANDIDATE_GUARD");
});

test("Video2Audio one-shot policy exposes genuine create, revalidate, consume and type-guard APIs", () => {
  assert.ok(oneShotModule, "MISSING_OWNER_VIDEO2AUDIO_ONE_SHOT_POLICY_MODULE");
  for (const name of ["createOwnerVideo2AudioOneShotPermit", "revalidateOwnerVideo2AudioOneShotPermit",
    "consumeOwnerVideo2AudioOneShotPermit", "isOwnerVideo2AudioOneShotPermit"]) {
    assert.equal(typeof oneShotModule[name], "function", `MISSING_${name.toUpperCase()}`);
  }
});

test("pure prompt normalization trims a valid Unicode prompt and rejects malformed or oversized text", () => {
  const normalizePrompt = inputModule.normalizeOwnerVideo2AudioPrompt as ((value: unknown, profile: unknown) => string) | undefined;
  assert.equal(typeof normalizePrompt, "function", "MISSING_OWNER_VIDEO2AUDIO_PURE_PROMPT_NORMALIZER");
  const profile = createOwnerVideo2AudioSourceProfile();
  assert.equal(normalizePrompt!("  Преобразуй в речь 🌙  ", profile), "Преобразуй в речь 🌙");
  assert.throws(() => normalizePrompt!("bad\u0000prompt", profile),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROMPT_INVALID");
  assert.throws(() => normalizePrompt!("\ud800", profile),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROMPT_INVALID");
  assert.throws(() => normalizePrompt!("x".repeat(5_001), profile),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROMPT_INVALID");
});

test("preparation yields only a safe candidate and the exact private body from the captured upload witness", async () => {
  const createPreparer = preparerModule?.createOwnerVideo2AudioRequestPreparer as ((input: unknown) => any) | undefined;
  assert.equal(typeof createPreparer, "function", "MISSING_OWNER_VIDEO2AUDIO_REQUEST_PREPARER_FACTORY");
  const profile = createOwnerVideo2AudioSourceProfile();
  const links = await linkedService();
  const nativeClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => response({ total: 1, successful: 1,
    failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL, status: "success", content_type: "video/mp4",
      size: MP4.byteLength, duration: 5.64 }] }) });
  const originalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING, linkService: links,
    resolveClient: () => nativeClient, now: () => 2_000 });
  const preparer = createPreparer!({ profile, originalReferenceService: originalService, now: () => 2_000 });
  try {
    const receipt = await originalService.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "  Преобразуй клип в речь 🌙  ",
      video_original_handle: receipt.video_original_handle });
    assert.equal((preparerModule?.isOwnerVideo2AudioPreparedCandidate as (value: unknown) => boolean)(candidate), true);
    assert.equal(candidate.status, "blocked");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.runtime_usable, false);
    assert.equal(candidate.original.duration_seconds, 5.64);
    assert.deepEqual(candidate.source_binding, {
      public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
      form_sha256: "sha256:46f99867fa2ed84c1784bfcf00ca62e32b9b481f2eea661bc6e7870218d84e12"
    });
    for (const privateValue of ["Преобразуй клип", receipt.video_original_handle, UPLOAD_URL, "original.mp4",
      Buffer.from(MP4).toString("base64"), "principal", "native_reference"]) {
      assert.equal(JSON.stringify(candidate).includes(privateValue), false, `public candidate leaked ${privateValue}`);
    }
    const context = preparer.inspectCandidate(candidate);
    assert.equal(context.attempt_id, ATTEMPT);
    assert.equal(context.original_handle, receipt.video_original_handle);
    assert.equal(context.principal.connection_id, ATTEMPT);
    assert.equal(context.captured_client, nativeClient);
    assert.ok(context.captured_reference);
    const request = preparer.getPrivateRequest(candidate);
    assert.deepEqual(Object.keys(request), ["prompt", "settings"]);
    assert.equal(request.prompt, "Преобразуй клип в речь 🌙");
    assert.deepEqual(Object.keys(request.settings), ["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"]);
    assert.deepEqual(request.settings, { model_type: "video2audio", mode: "generate", duration: 5.64,
      negative_prompt: "", seed: 0, file_urls: [{ type: "video", url: UPLOAD_URL }] });
  } finally { await preparer.close?.(); await originalService.close(); }
});

test("the nominal one-shot receipt binds the genuine candidate and principal, requires revalidation, and consumes only once", async () => {
  const createPreparer = preparerModule?.createOwnerVideo2AudioRequestPreparer as ((input: unknown) => any) | undefined;
  const createPermit = oneShotModule?.createOwnerVideo2AudioOneShotPermit as ((input: unknown) => Promise<any>) | undefined;
  const revalidate = oneShotModule?.revalidateOwnerVideo2AudioOneShotPermit as ((input: unknown) => Promise<void>) | undefined;
  const consume = oneShotModule?.consumeOwnerVideo2AudioOneShotPermit as ((input: unknown) => unknown) | undefined;
  assert.equal(typeof createPermit, "function");
  const profile = createOwnerVideo2AudioSourceProfile();
  const links = await linkedService();
  const nativeClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => response({ total: 1, successful: 1,
    failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL, status: "success", content_type: "video/mp4",
      size: MP4.byteLength, duration: 5.64 }] }) });
  const originalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING, linkService: links,
    resolveClient: () => nativeClient, now: () => 3_000 });
  const preparer = createPreparer!({ profile, originalReferenceService: originalService, now: () => 3_000 });
  try {
    const uploaded = await originalService.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "Создай звуковую дорожку", video_original_handle: uploaded.video_original_handle });
    const binding = preparer.inspectCandidate(candidate);
    const permitInput = { preparer, candidate, principal: binding.principal, attemptId: ATTEMPT };
    await assert.rejects(() => createPermit!({ ...permitInput, principal: { ...binding.principal, subject_id: "other" } }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
    const forgedCandidate = { ...candidate };
    assert.equal((preparerModule?.isOwnerVideo2AudioPreparedCandidate as (value: unknown) => boolean)(forgedCandidate), false);
    await assert.rejects(() => createPermit!({ ...permitInput, candidate: forgedCandidate }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");

    const racedPermits = await Promise.allSettled([createPermit!(permitInput), createPermit!(permitInput)]);
    const fulfilled = racedPermits.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");
    const rejected = racedPermits.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(fulfilled.length, 1, "concurrent permit requests for one candidate mint exactly one nominal receipt");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.reason?.code, "CANDIDATE_ALREADY_ISSUED");
    const permit = fulfilled[0]!.value;
    assert.equal((oneShotModule?.isOwnerVideo2AudioOneShotPermit as (value: unknown) => boolean)(permit), true);
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    for (const privateValue of [uploaded.video_original_handle, UPLOAD_URL, "Создай звуковую дорожку", "principal"]) {
      assert.equal(JSON.stringify(permit).includes(privateValue), false);
    }
    const permitContext = { ...permitInput, permit };
    assert.throws(() => consume!(permitContext),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_NOT_REVALIDATED");
    const originalGetStatus = links.getStatus.bind(links);
    let readCount = 0, markFirstReadBlocked!: () => void, releaseFirstRead!: () => void;
    const firstReadBlocked = new Promise<void>((resolve) => { markFirstReadBlocked = resolve; });
    const firstReadRelease = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    links.getStatus = async (...args: Parameters<typeof links.getStatus>) => {
      readCount += 1;
      if (readCount === 1) { markFirstReadBlocked(); await firstReadRelease; }
      return originalGetStatus(...args);
    };
    const delayedRevalidation = revalidate!(permitContext);
    await firstReadBlocked;
    await revalidate!(permitContext);
    assert.deepEqual(consume!(permitContext), { status: "consumed", dispatch_allowed: false,
      request_fingerprint: candidate.request_fingerprint });
    releaseFirstRead();
    await assert.rejects(() => delayedRevalidation,
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.throws(() => consume!(permitContext),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
    await assert.rejects(() => revalidate!(permitContext),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
    await assert.rejects(() => createPermit!(permitInput),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_ALREADY_ISSUED");
  } finally { await preparer.close?.(); await originalService.close(); }
});

test("the candidate retains its upload-time client during 14-minute rotation and expires with its original", async () => {
  let now = 1_000, resolveClientCalls = 0, uploadPosts = 0;
  const clock = () => now;
  const links = await linkedService([ATTEMPT], clock, 30 * 60_000);
  const profile = createOwnerVideo2AudioSourceProfile();
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    uploadPosts += 1;
    return response({ total: 1, successful: 1, failed: 0, duplicates: 0,
      files: [{ filename: "original.mp4", url: UPLOAD_URL, status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
  } });
  const rotatedClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("rotation must not upload again"); } });
  let currentClient = uploadClient;
  const originalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING, linkService: links,
    resolveClient: () => { resolveClientCalls += 1; return currentClient; }, now: clock });
  const createPreparer = preparerModule?.createOwnerVideo2AudioRequestPreparer as ((input: unknown) => any) | undefined;
  const preparer = createPreparer!({ profile, originalReferenceService: originalService, now: clock });
  try {
    const uploaded = await originalService.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    now += 14 * 60_000;
    currentClient = rotatedClient;
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "Собери аудио", video_original_handle: uploaded.video_original_handle });
    assert.equal(candidate.expires_at, 901_000, "candidate expiry remains capped by the original's 15-minute expiry");
    const binding = preparer.inspectCandidate(candidate);
    assert.equal(binding.captured_client, uploadClient);
    await preparer.revalidateCandidate(candidate);
    assert.equal(preparer.getPrivateRequest(candidate).settings.file_urls[0]?.url, UPLOAD_URL);
    assert.equal(resolveClientCalls, 1, "candidate preparation and revalidation never resolve a rotated client");
    assert.equal(uploadPosts, 1);
    now += 60_000;
    assert.equal((preparerModule?.isOwnerVideo2AudioPreparedCandidate as (value: unknown) => boolean)(candidate), false,
      "the public nominal guard must recheck expiry without requiring an inspect call first");
    assert.equal(preparer.inspectCandidate(candidate), undefined);
  } finally { await preparer.close(); await originalService.close(); }
});

test("a foreign linked attempt cannot prepare the original and its denial leaves the owner's candidate valid", async () => {
  const links = await linkedService([ATTEMPT, FOREIGN_ATTEMPT], () => 1_000, 30 * 60_000);
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, FOREIGN_ATTEMPT);
  await links.checkAttempt(BINDING, FOREIGN_ATTEMPT);
  const profile = createOwnerVideo2AudioSourceProfile();
  let uploadPosts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    uploadPosts += 1;
    return response({ total: 1, successful: 1, failed: 0, duplicates: 0,
      files: [{ filename: "original.mp4", url: UPLOAD_URL, status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
  } });
  const originalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING, linkService: links,
    resolveClient: () => client, now: () => 2_000 });
  const createPreparer = preparerModule?.createOwnerVideo2AudioRequestPreparer as ((input: unknown) => any) | undefined;
  const preparer = createPreparer!({ profile, originalReferenceService: originalService, now: () => 2_000 });
  try {
    const uploaded = await originalService.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "Собери аудио", video_original_handle: uploaded.video_original_handle });
    await assert.rejects(() => preparer.prepare({ attemptId: FOREIGN_ATTEMPT, prompt: "Другой запрос",
      video_original_handle: uploaded.video_original_handle }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(preparer.inspectCandidate(candidate)?.attempt_id, ATTEMPT);
    await preparer.revalidateCandidate(candidate);
    assert.equal(uploadPosts, 1);
  } finally { await preparer.close(); await originalService.close(); }
});

test("original-attempt invalidation expires its prepared candidate before revalidation or permit use", async () => {
  const links = await linkedService([ATTEMPT], () => 1_000, 30 * 60_000);
  const profile = createOwnerVideo2AudioSourceProfile();
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => response({ total: 1, successful: 1,
    failed: 0, duplicates: 0, files: [{ filename: "original.mp4", url: UPLOAD_URL, status: "success", content_type: "video/mp4",
      size: MP4.byteLength, duration: 5.64 }] }) });
  const originalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING, linkService: links,
    resolveClient: () => client, now: () => 4_000 });
  const createPreparer = preparerModule?.createOwnerVideo2AudioRequestPreparer as ((input: unknown) => any) | undefined;
  const preparer = createPreparer!({ profile, originalReferenceService: originalService, now: () => 4_000 });
  try {
    const uploaded = await originalService.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "Собери аудио", video_original_handle: uploaded.video_original_handle });
    await originalService.invalidateAttempt(ATTEMPT);
    assert.equal(preparer.inspectCandidate(candidate), undefined, "the original service revocation invalidates dependent preparations");
    assert.equal((preparerModule?.isOwnerVideo2AudioPreparedCandidate as (value: unknown) => boolean)(candidate), false);
    await assert.rejects(() => preparer.revalidateCandidate(candidate),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
  } finally { await preparer.close(); await originalService.close(); }
});
