import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOwnerFlux3UploadReferenceForClient, SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { OwnerFlux3MediaReferenceService } from "../src/application/owner-flux3-media-reference-service.js";
import {
  createOwnerFlux3VideoOwnedRequestPreparer,
  isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService,
  OwnerFlux3VideoOwnedRequestPreparerError,
  readOwnerFlux3VideoOwnedCandidateBinding
} from "../src/application/owner-flux3-video-owned-request-preparer.js";
import {
  consumeOwnerFlux3VideoOwnedOneShotPermit,
  createOwnerFlux3VideoOwnedOneShotPermit,
  OwnerFlux3VideoOwnedOneShotPolicyError,
  revalidateOwnerFlux3VideoOwnedOneShotPermit
} from "../src/application/owner-flux3-video-owned-one-shot-policy.js";

const BINDING: AuthBinding = Object.freeze({ tenant_id: "flux3-owned-preparer-2013", subject: "synthetic-owner" });
const ATTEMPTS = Object.freeze([
  "link_flux3_owned_preparer_a_2013_000001",
  "link_flux3_owned_preparer_b_2013_000002"
]);
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VIDEO_FFPROBE = JSON.stringify({ streams: [
  { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "12.0", disposition: { attached_pic: 0 } },
  { codec_type: "audio", codec_name: "aac", duration: "12.0" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.0" } });
const PARAMS = Object.freeze({ resolution: "hd", video_duration: 5, generate_audio: true });

function response(value: unknown): Response { return Response.json(value); }
function png(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_1X1); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24); return bytes;
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

async function makeRuntime(input: {
  readonly attempts: readonly string[];
  readonly imageUrl?: (attemptId: string, filename: string, bytes: Uint8Array) => string;
}) {
  let nextAttempt = 0, now = Date.now(), currentUploadingClient: SyntxChatHttpClient | undefined;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "flux3-preparer-synthetic", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-flux3-preparer-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), {
    now: () => now, attemptIdGenerator: () => input.attempts[nextAttempt++]!
  });
  for (const attemptId of input.attempts) {
    const created = await links.createAttempt(BINDING);
    assert.equal(created.attempt_id, attemptId);
    await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId);
  }
  const clients = new Map<string, SyntxChatHttpClient>();
  const fetchImpl: typeof fetch = async (request, init = {}) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    assert.equal(url.href, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init.method, "POST");
    const form = init.body as FormData, file = form.get("files");
    assert.ok(file instanceof File);
    const attemptId = [...clients.entries()].find(([, client]) => client === currentUploadingClient)?.[0];
    assert.ok(attemptId);
    const modelType = form.get("model_type"), filename = file.name, mime = file.type, size = file.size;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const objectUrl = modelType === "flux3_i2v"
      ? input.imageUrl?.(attemptId, filename, bytes) ?? `https://r2.syntx.ai/flux3-i2v/${encodeURIComponent(attemptId)}/${encodeURIComponent(filename)}`
      : `https://r2.syntx.ai/flux3-v2v/${encodeURIComponent(attemptId)}/${encodeURIComponent(filename)}`;
    bytes.fill(0);
    return response({ files: [{ filename, url: objectUrl, status: "success", size, content_type: mime }] });
  };
  for (const attemptId of input.attempts) {
    const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return links.useCredential(BINDING, attemptId, (value) => operation(value.value));
    } };
    clients.set(attemptId, new SyntxChatHttpClient({ credentialBroker, fetchImpl }));
  }
  const resolveClient = (attemptId: string) => {
    const client = clients.get(attemptId);
    if (!client) throw new Error("unexpected attempt");
    currentUploadingClient = client;
    return client;
  };
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-owned-preparer-2013-"));
  const ffprobe = join(directory, "ffprobe-fixture"), quoted = shellQuote(VIDEO_FFPROBE);
  await writeFile(ffprobe, `#!/bin/sh\nprintf '%s' ${quoted}\n`, { mode: 0o700, flag: "wx" }); await chmod(ffprobe, 0o700);
  const referenceService = new OwnerFlux3MediaReferenceService({ binding: BINDING, linkService: links,
    resolveClient, ffprobePath: await realpath(ffprobe), destination: "hidden", now: () => now });
  const preparer = createOwnerFlux3VideoOwnedRequestPreparer({ referenceService, now: () => now });
  return {
    links, referenceService, preparer, directory,
    advanceClock(milliseconds: number) { now += milliseconds; },
    upload(attemptId: string, model_id: "flux3_i2v" | "flux3_v2v", filename: string, bytes: Uint8Array, mime_type: "image/png" | "video/mp4") {
      return referenceService.uploadReference({ attemptId, model_id, filename, bytes, mime_type });
    },
    async close() { await preparer.close(); await referenceService.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

test("Flux3 I2V prepares source-ordered URLs, collapses an exact duplicate and hides prompt/handles", async () => {
  const runtime = await makeRuntime({ attempts: [ATTEMPTS[0]!] });
  try {
    const attemptId = ATTEMPTS[0]!;
    const first = await runtime.upload(attemptId, "flux3_i2v", "first.png", png(640, 360), "image/png");
    const second = await runtime.upload(attemptId, "flux3_i2v", "second.png", png(641, 360), "image/png");
    const candidate = await runtime.preparer.prepare({ attemptId, request: {
      model_id: "flux3_i2v", prompt: "explicit source-bound prompt",
      flux3_reference_handles: [first.flux3_reference_handle, second.flux3_reference_handle, first.flux3_reference_handle], parameters: PARAMS
    } });
    const privateRequest = runtime.preparer.getPrivateRequest(candidate);
    assert.equal(privateRequest.prompt, "explicit source-bound prompt");
    assert.deepEqual(Object.keys(privateRequest.settings), ["model_type", "video_duration", "resolution", "aspect_ratio", "generate_audio", "file_urls"]);
    assert.deepEqual(privateRequest.settings.file_urls, [
      { type: "image", url: `https://r2.syntx.ai/flux3-i2v/${encodeURIComponent(attemptId)}/first.png` },
      { type: "image", url: `https://r2.syntx.ai/flux3-i2v/${encodeURIComponent(attemptId)}/second.png` }
    ]);
    assert.equal(isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(runtime.preparer, runtime.referenceService), true);
    const binding = readOwnerFlux3VideoOwnedCandidateBinding(runtime.preparer, candidate, runtime.referenceService);
    assert.equal(binding?.sources.length, 2);
    assert.equal(binding?.source_sha256s.length, 2);
    assert.equal(readOwnerFlux3VideoOwnedCandidateBinding(runtime.preparer, candidate, {}), undefined);
    const captured = runtime.preparer.withCapturedNativeReferences(candidate, (client, contexts) => ({
      client,
      urls: contexts.map((context) => readOwnerFlux3UploadReferenceForClient(client, context)?.url),
      contexts
    }));
    assert.ok(captured.client instanceof SyntxChatHttpClient);
    assert.deepEqual(captured.urls, [...privateRequest.settings.file_urls.map((entry) => entry.url), privateRequest.settings.file_urls[0]!.url]);
    assert.equal(captured.contexts.length, 3);
    assert.equal(captured.contexts[0], captured.contexts[2]);
    assert.throws(() => runtime.preparer.withCapturedNativeReferences(candidate, async () => undefined),
      (error: unknown) => error instanceof OwnerFlux3VideoOwnedRequestPreparerError && error.code === "INVALID_REQUEST");
    assert.equal(isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(runtime.preparer, {}), false);
    const publicJson = JSON.stringify(candidate);
    assert.equal(publicJson.includes("explicit source-bound prompt"), false);
    assert.equal(publicJson.includes(first.flux3_reference_handle), false);
    assert.equal(publicJson.includes("https://r2.syntx.ai"), false);
    assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.backend_acceptance, "UNPROVEN");
  } finally { await runtime.close(); }
});

test("Flux3 V2V prepares only its one video source and allows an explicitly empty prompt", async () => {
  const runtime = await makeRuntime({ attempts: [ATTEMPTS[0]!] });
  try {
    const attemptId = ATTEMPTS[0]!, original = await runtime.upload(attemptId, "flux3_v2v", "original.mp4", mp4Bytes(), "video/mp4");
    const candidate = await runtime.preparer.prepare({ attemptId, request: {
      model_id: "flux3_v2v", prompt: "", flux3_reference_handles: [original.flux3_reference_handle],
      parameters: { resolution: "fhd", video_duration: 15, generate_audio: false }
    } });
    const privateRequest = runtime.preparer.getPrivateRequest(candidate);
    assert.equal(privateRequest.prompt, "");
    assert.deepEqual(privateRequest.settings.file_urls, [{ type: "video",
      url: `https://r2.syntx.ai/flux3-v2v/${encodeURIComponent(attemptId)}/original.mp4` }]);
    for (const key of ["n", "draft", "width", "height", "duration_seconds"]) assert.equal(Object.hasOwn(privateRequest.settings, key), false);
    await assert.rejects(runtime.preparer.prepare({ attemptId, request: {
      model_id: "flux3_v2v", prompt: "", flux3_reference_handles: [original.flux3_reference_handle, original.flux3_reference_handle],
      parameters: { resolution: "fhd", video_duration: 15, generate_audio: false }
    } }), (error: unknown) => error instanceof OwnerFlux3VideoOwnedRequestPreparerError && error.code === "REFERENCE_COUNT_INVALID");
    await assert.rejects(runtime.preparer.prepare({ attemptId, request: {
      model_id: "flux3_v2v", prompt: "x".repeat(65_537), flux3_reference_handles: [original.flux3_reference_handle],
      parameters: { resolution: "fhd", video_duration: 15, generate_audio: false }
    } }), (error: unknown) => error instanceof OwnerFlux3VideoOwnedRequestPreparerError && error.code === "PROMPT_LOCAL_LIMIT_EXCEEDED");
  } finally { await runtime.close(); }
});

test("Flux3 capture rejects an accessor then member without invoking its getter", async () => {
  const runtime = await makeRuntime({ attempts: [ATTEMPTS[0]!] });
  try {
    const attemptId = ATTEMPTS[0]!, ref = await runtime.upload(attemptId, "flux3_i2v", "then-accessor.png", png(640, 360), "image/png");
    const candidate = await runtime.preparer.prepare({ attemptId, request: { model_id: "flux3_i2v", prompt: "accessor test",
      flux3_reference_handles: [ref.flux3_reference_handle], parameters: PARAMS } });
    let getterCalls = 0;
    const accessorThen = Object.defineProperty({}, "then", { enumerable: true, get() { getterCalls += 1; return () => undefined; } });
    assert.throws(() => runtime.preparer.withCapturedNativeReferences(candidate, () => accessorThen),
      (error: unknown) => error instanceof OwnerFlux3VideoOwnedRequestPreparerError && error.code === "INVALID_REQUEST");
    assert.equal(getterCalls, 0, "then detection must reject accessors without reading them");
  } finally { await runtime.close(); }
});

test("Flux3 duplicate source TTL is bounded by every captured handle, not only its deduplicated representative", async () => {
  const runtime = await makeRuntime({ attempts: [ATTEMPTS[0]!], imageUrl: () => "https://r2.syntx.ai/flux3-i2v/shared-identical.png" });
  try {
    const attemptId = ATTEMPTS[0]!, bytes = png(640, 360);
    const older = await runtime.upload(attemptId, "flux3_i2v", "older.png", bytes, "image/png");
    const olderResolution = await runtime.referenceService.resolveReference({ attemptId, model_id: "flux3_i2v", flux3_reference_handle: older.flux3_reference_handle });
    runtime.advanceClock(60_000);
    const newer = await runtime.upload(attemptId, "flux3_i2v", "newer.png", bytes, "image/png");
    const newerResolution = await runtime.referenceService.resolveReference({ attemptId, model_id: "flux3_i2v", flux3_reference_handle: newer.flux3_reference_handle });
    assert.ok(newerResolution.expires_at > olderResolution.expires_at, "fixture handles must have staggered expiries");
    const candidate = await runtime.preparer.prepare({ attemptId, request: { model_id: "flux3_i2v", prompt: "same source twice",
      flux3_reference_handles: [newer.flux3_reference_handle, older.flux3_reference_handle], parameters: PARAMS } });
    assert.equal(candidate.sources.length, 1, "identical URL and bytes still collapse to one wire source");
    assert.ok(candidate.expires_at <= olderResolution.expires_at, "candidate lifetime cannot outlive any captured handle");
  } finally { await runtime.close(); }
});

test("Flux3 semantic claim is created only on consume and fences an equivalent other attempt", async () => {
  const runtime = await makeRuntime({ attempts: [ATTEMPTS[0]!, ATTEMPTS[1]!] });
  try {
    const firstAttempt = ATTEMPTS[0]!, secondAttempt = ATTEMPTS[1]!;
    const firstRef = await runtime.upload(firstAttempt, "flux3_i2v", "source-a.png", png(640, 360), "image/png");
    const secondRef = await runtime.upload(secondAttempt, "flux3_i2v", "source-b.png", png(640, 360), "image/png");
    const params = { resolution: "hd", video_duration: 5, generate_audio: true } as const;
    const first = await runtime.preparer.prepare({ attemptId: firstAttempt, request: {
      model_id: "flux3_i2v", prompt: "one semantic intent", flux3_reference_handles: [firstRef.flux3_reference_handle], parameters: params
    } });
    const second = await runtime.preparer.prepare({ attemptId: secondAttempt, request: {
      model_id: "flux3_i2v", prompt: "one semantic intent", flux3_reference_handles: [secondRef.flux3_reference_handle], parameters: params
    } });
    assert.equal(first.intent_fingerprint, second.intent_fingerprint);
    assert.notEqual(first.request_fingerprint, second.request_fingerprint);
    const firstPrincipal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: firstAttempt } as const;
    const secondPrincipal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: secondAttempt } as const;
    const firstPermit = await createOwnerFlux3VideoOwnedOneShotPermit({ preparer: runtime.preparer, candidate: first, principal: firstPrincipal, attemptId: firstAttempt });
    const secondPermit = await createOwnerFlux3VideoOwnedOneShotPermit({ preparer: runtime.preparer, candidate: second, principal: secondPrincipal, attemptId: secondAttempt });
    assert.equal(firstPermit.dispatch_allowed, false); assert.equal(secondPermit.dispatch_allowed, false);
    await revalidateOwnerFlux3VideoOwnedOneShotPermit({ preparer: runtime.preparer, candidate: first, permit: firstPermit, principal: firstPrincipal, attemptId: firstAttempt });
    await revalidateOwnerFlux3VideoOwnedOneShotPermit({ preparer: runtime.preparer, candidate: second, permit: secondPermit, principal: secondPrincipal, attemptId: secondAttempt });
    consumeOwnerFlux3VideoOwnedOneShotPermit({ preparer: runtime.preparer, candidate: first, permit: firstPermit, principal: firstPrincipal, attemptId: firstAttempt });
    await assert.rejects(revalidateOwnerFlux3VideoOwnedOneShotPermit({ preparer: runtime.preparer, candidate: second, permit: secondPermit, principal: secondPrincipal, attemptId: secondAttempt }),
      (error: unknown) => error instanceof OwnerFlux3VideoOwnedOneShotPolicyError && error.code === "INTENT_ALREADY_CLAIMED");
  } finally { await runtime.close(); }
});

test("Flux3 rejects a repeated URL that is bound to different source bytes", async () => {
  const runtime = await makeRuntime({ attempts: [ATTEMPTS[0]!], imageUrl: () => "https://r2.syntx.ai/flux3-i2v/same-object.png" });
  try {
    const attemptId = ATTEMPTS[0]!;
    const first = await runtime.upload(attemptId, "flux3_i2v", "first.png", png(640, 360), "image/png");
    const second = await runtime.upload(attemptId, "flux3_i2v", "second.png", png(641, 360), "image/png");
    await assert.rejects(runtime.preparer.prepare({ attemptId, request: {
      model_id: "flux3_i2v", prompt: "conflicting source binding",
      flux3_reference_handles: [first.flux3_reference_handle, second.flux3_reference_handle], parameters: PARAMS
    } }), (error: unknown) => error instanceof OwnerFlux3VideoOwnedRequestPreparerError && error.code === "REFERENCE_URL_IDENTITY_CONFLICT");
  } finally { await runtime.close(); }
});
