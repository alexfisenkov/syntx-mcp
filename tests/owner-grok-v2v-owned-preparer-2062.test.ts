import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOwnerGrokV2vUploadReferenceForClient, SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { OwnerGrokV2vUploadContext } from "../src/adapter/syntx/grok-v2v-media-upload.js";
import {
  OwnerGrokV2vOriginalReferenceService
} from "../src/application/owner-grok-v2v-original-reference-service.js";
import {
  createOwnerGrokV2vOwnedRequestPreparer,
  isOwnerGrokV2vOwnedPreparedCandidate,
  isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService,
  OwnerGrokV2vOwnedRequestPreparerError,
  readOwnerGrokV2vOwnedCandidateBinding
} from "../src/application/owner-grok-v2v-owned-request-preparer.js";
import {
  consumeOwnerGrokV2vOwnedOneShotPermit,
  createOwnerGrokV2vOwnedOneShotPermit,
  OwnerGrokV2vOwnedOneShotPolicyError,
  revalidateOwnerGrokV2vOwnedOneShotPermit
} from "../src/application/owner-grok-v2v-owned-one-shot-policy.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";

const ATTEMPT = "link_grok_v2v_owned_2062_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "grok-v2v-owned-2062", subject: "synthetic-owner" });
const PROMPT = "Use the uploaded shot as temporal motion context.";
const posixFixture = { skip: process.platform === "win32" ? "POSIX ffprobe fixture; real Windows ffprobe acceptance NOT_RUN" : false };
const PROBE_FFPROBE = JSON.stringify({ streams: [
  { index: 0, codec_type: "video", codec_name: "h264", width: 672, height: 610, duration: "3.14159", disposition: { attached_pic: 0 } },
  { index: 1, codec_type: "audio", codec_name: "aac", duration: "3.1" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.14159" } });

function response(value: unknown, status = 200): Response { return Response.json(value, { status }); }
function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function principal(attemptId = ATTEMPT) {
  return { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId } as const;
}

async function makeRuntime() {
  let now = 1_000_000, activeClient: SyntxChatHttpClient | undefined, uploadCalls = 0;
  const clock = () => now;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-grok-v2v-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-grok-v2v-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(clock), {
    now: clock, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  const created = await links.createAttempt(BINDING);
  assert.equal(created.attempt_id, ATTEMPT);
  await links.issueHandoff(BINDING, ATTEMPT);
  await links.checkAttempt(BINDING, ATTEMPT);
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, value => operation(value.value));
  } };
  const fetchImpl: typeof fetch = async (request, init = {}) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    assert.equal(url.href, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init.method, "POST");
    const form = init.body as FormData, file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(form.get("model_type"), "grok_v2v");
    assert.equal(form.get("destination"), "hidden");
    assert.equal(file.name, "owned-source.mp4");
    assert.equal(file.type, "video/mp4");
    uploadCalls += 1;
    return response({ files: [{ filename: file.name, url: "https://r2.syntx.ai/grok-v2v/hidden/owned-source.mp4",
      status: "success", size: file.size, content_type: file.type }] });
  };
  activeClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl });
  const resolveClient = () => activeClient!;
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-owned-preparer-2062-"));
  const ffprobePath = join(directory, "ffprobe-fixture");
  await writeFile(ffprobePath, `#!/bin/sh\nprintf '%s' ${shellQuote(PROBE_FFPROBE)}\n`, { mode: 0o700, flag: "wx" });
  await chmod(ffprobePath, 0o700);
  const referenceService = new OwnerGrokV2vOriginalReferenceService({
    binding: BINDING, linkService: links, resolveClient, ffprobePath: await realpath(ffprobePath), destination: "hidden", now: clock
  });
  const preparer = createOwnerGrokV2vOwnedRequestPreparer({ referenceService, now: clock });
  const receipt = await referenceService.uploadReference({
    attemptId: ATTEMPT, model_id: "grok_v2v", filename: "owned-source.mp4", mime_type: "video/mp4", bytes: mp4Bytes()
  });
  return {
    referenceService, preparer, receipt, directory,
    get uploadCalls() { return uploadCalls; },
    advance(milliseconds: number) { now += milliseconds; },
    switchClient() { activeClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl }); },
    async close() { await preparer.close(); await referenceService.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

test("Grok V2V binds one owned MP4, exact measured settings and cost without exposing handle or URL", posixFixture, async () => {
  const runtime = await makeRuntime();
  try {
    const candidate = await runtime.preparer.prepare({
      attemptId: ATTEMPT,
      request: { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: runtime.receipt.grok_reference_handle }
    });
    const privateRequest = runtime.preparer.getPrivateRequest(candidate);
    assert.equal(privateRequest.prompt, PROMPT);
    assert.deepEqual(privateRequest.settings, {
      model_type: "grok_v2v", aspect_ratio: null, video_duration: 3.14, resolution: "720p",
      file_urls: [{ type: "video", url: "https://r2.syntx.ai/grok-v2v/hidden/owned-source.mp4" }]
    });
    assert.deepEqual(privateRequest.cost_parameters, { video_duration: 3.14, resolution: "720p" });
    assert.equal(isOwnerGrokV2vOwnedPreparedCandidate(candidate), true);
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService(runtime.preparer, runtime.referenceService), true);
    const binding = readOwnerGrokV2vOwnedCandidateBinding(runtime.preparer, candidate, runtime.referenceService);
    assert.equal(binding?.attempt_id, ATTEMPT);
    assert.equal(binding?.principal.tenant_id, BINDING.tenant_id);
    assert.equal(binding?.sources.length, 1);
    assert.equal(binding?.sources[0]?.duration_seconds, 3.14159);
    assert.equal(binding?.grok_reference_handle, runtime.receipt.grok_reference_handle);
    assert.equal(readOwnerGrokV2vOwnedCandidateBinding(runtime.preparer, candidate, {}), undefined);
    const captured = runtime.preparer.withCapturedNativeReference(candidate, (client, context: OwnerGrokV2vUploadContext) => {
      const witness = readOwnerGrokV2vUploadReferenceForClient(client, context);
      return { client, url: witness?.url };
    });
    assert.ok(captured.client instanceof SyntxChatHttpClient);
    assert.equal(captured.url, privateRequest.settings.file_urls[0]?.url);
    const publicCandidate = JSON.stringify(candidate);
    assert.equal(publicCandidate.includes(PROMPT), false);
    assert.equal(publicCandidate.includes(runtime.receipt.grok_reference_handle), false);
    assert.equal(publicCandidate.includes("https://r2.syntx.ai"), false);
    for (const key of ["url", "prompt", "grok_reference_handle", "attempt_id", "principal"]) {
      assert.equal(Object.hasOwn(candidate, key), false);
    }
    assert.equal(runtime.uploadCalls, 1);
  } finally { await runtime.close(); }
});

test("Grok V2V preparer rejects caller-supplied controls, identifiers, URLs, and wrong model", posixFixture, async () => {
  const runtime = await makeRuntime();
  try {
    const handle = runtime.receipt.grok_reference_handle;
    const invalid = [
      { model_id: "grok_t2v", prompt: PROMPT, grok_reference_handle: handle },
      { model_id: "grok_v2v", prompt: " ", grok_reference_handle: handle },
      { model_id: "grok_v2v", prompt: "x".repeat(2_001), grok_reference_handle: handle },
      { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: handle, parameters: { resolution: "480p" } },
      { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: handle, video_duration: 3 },
      { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: handle, file_urls: [{ type: "video", url: "https://r2.syntx.ai/x" }] },
      { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: handle, chat_id: "caller-id" }
    ];
    for (const request of invalid) {
      await assert.rejects(runtime.preparer.prepare({ attemptId: ATTEMPT, request }), OwnerGrokV2vOwnedRequestPreparerError);
    }
    await assert.rejects(runtime.preparer.prepare({ attemptId: ATTEMPT,
      request: { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: "not-owned" } }), OwnerGrokV2vOwnedRequestPreparerError);
    assert.equal(runtime.uploadCalls, 1);
  } finally { await runtime.close(); }
});

test("Grok V2V one-shot permit requires the exact full owner binding and is consumed once", posixFixture, async () => {
  const runtime = await makeRuntime();
  try {
    const candidate = await runtime.preparer.prepare({ attemptId: ATTEMPT,
      request: { model_id: "grok_v2v", prompt: PROMPT, grok_reference_handle: runtime.receipt.grok_reference_handle } });
    const owner = principal();
    const foreign = { ...owner, tenant_id: "foreign-tenant" };
    await assert.rejects(createOwnerGrokV2vOwnedOneShotPermit({ preparer: runtime.preparer, candidate, principal: foreign, attemptId: ATTEMPT }),
      OwnerGrokV2vOwnedOneShotPolicyError);
    await assert.rejects(createOwnerGrokV2vOwnedOneShotPermit({ preparer: runtime.preparer, candidate: { ...candidate }, principal: owner, attemptId: ATTEMPT }),
      OwnerGrokV2vOwnedOneShotPolicyError);
    const permit = await createOwnerGrokV2vOwnedOneShotPermit({ preparer: runtime.preparer, candidate, principal: owner, attemptId: ATTEMPT });
    await revalidateOwnerGrokV2vOwnedOneShotPermit({ preparer: runtime.preparer, candidate, principal: owner, attemptId: ATTEMPT, permit });
    const receipt = consumeOwnerGrokV2vOwnedOneShotPermit({ preparer: runtime.preparer, candidate, principal: owner, attemptId: ATTEMPT, permit });
    assert.equal(receipt.status, "consumed");
    assert.equal(receipt.dispatch_allowed, false);
    assert.equal(receipt.request_fingerprint, candidate.request_fingerprint);
    assert.throws(() => consumeOwnerGrokV2vOwnedOneShotPermit({ preparer: runtime.preparer, candidate, principal: owner, attemptId: ATTEMPT, permit }),
      OwnerGrokV2vOwnedOneShotPolicyError);
  } finally { await runtime.close(); }
});

test("Grok V2V candidate rejects current-client drift and cannot outlive source TTL", posixFixture, async () => {
  const runtime = await makeRuntime();
  try {
    const driftPrompt = `${PROMPT} client drift`;
    const candidate = await runtime.preparer.prepare({ attemptId: ATTEMPT,
      request: { model_id: "grok_v2v", prompt: driftPrompt, grok_reference_handle: runtime.receipt.grok_reference_handle } });
    runtime.switchClient();
    await assert.rejects(createOwnerGrokV2vOwnedOneShotPermit({
      preparer: runtime.preparer, candidate, principal: principal(), attemptId: ATTEMPT
    }), OwnerGrokV2vOwnedOneShotPolicyError);
    let callbackCalls = 0;
    assert.throws(() => runtime.preparer.withCapturedNativeReference(candidate, () => { callbackCalls += 1; return undefined; }),
      OwnerGrokV2vOwnedRequestPreparerError);
    assert.equal(callbackCalls, 0);
  } finally { await runtime.close(); }

  const expired = await makeRuntime();
  try {
    const expiredPrompt = `${PROMPT} expired`;
    const candidate = await expired.preparer.prepare({ attemptId: ATTEMPT,
      request: { model_id: "grok_v2v", prompt: expiredPrompt, grok_reference_handle: expired.receipt.grok_reference_handle } });
    const permit = await createOwnerGrokV2vOwnedOneShotPermit({
      preparer: expired.preparer, candidate, principal: principal(), attemptId: ATTEMPT
    });
    expired.advance(16 * 60_000);
    await assert.rejects(revalidateOwnerGrokV2vOwnedOneShotPermit({
      preparer: expired.preparer, candidate, principal: principal(), attemptId: ATTEMPT, permit
    }), OwnerGrokV2vOwnedOneShotPolicyError);
    assert.throws(() => expired.preparer.getPrivateRequest(candidate), OwnerGrokV2vOwnedRequestPreparerError);
    assert.equal(isOwnerGrokV2vOwnedPreparedCandidate(candidate), false);
  } finally { await expired.close(); }
});
