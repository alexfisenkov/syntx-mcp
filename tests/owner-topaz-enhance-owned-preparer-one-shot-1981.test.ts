import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";
import type { OwnerTopazEnhanceParameterValues } from "../src/application/owner-topaz-enhance-parameters.js";
import type {
  OwnerTopazEnhanceOwnedCandidateBinding,
  OwnerTopazEnhanceOwnedPreparedCandidate,
  OwnerTopazEnhanceOwnedPreparedRequest
} from "../src/application/owner-topaz-enhance-owned-request-preparer.js";
import type {
  OwnerTopazEnhanceOwnedOneShotPermit,
  OwnerTopazEnhanceOwnedOneShotPermitReceipt
} from "../src/application/owner-topaz-enhance-owned-one-shot-policy.js";

const ORIGINAL_MODULE_URL = new URL("../src/application/owner-topaz-enhance-original-reference-service.js", import.meta.url).href;
const PREPARER_MODULE_URL = new URL("../src/application/owner-topaz-enhance-owned-request-preparer.js", import.meta.url).href;
const POLICY_MODULE_URL = new URL("../src/application/owner-topaz-enhance-owned-one-shot-policy.js", import.meta.url).href;
const originalModule = await import(ORIGINAL_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const preparerModule = await import(PREPARER_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const policyModule = await import(POLICY_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT_A = "link_topaz_enhance_owned_0123456789";
const ATTEMPT_B = "link_topaz_enhance_owned_abcdefghij";
const ATTEMPT_C = "link_topaz_enhance_owned_mnopqrstuvwx";
const BINDING = Object.freeze({ tenant_id: "topaz-enhance-owned-tenant", subject: "topaz-enhance-owned-subject" });
const MP4 = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x31, 0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);
const PROBE_JSON = JSON.stringify({ streams: [
  { codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "90", duration: "3.000000", disposition: { attached_pic: 0 } },
  { codec_type: "audio", codec_name: "aac", duration: "3.000000" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000" } });
const PARAMETERS: OwnerTopazEnhanceParameterValues = Object.freeze({
  blur: -10, halo: 0, focus: "normal", grain: "off", model: "rhea-1", noise: 10, details: 20,
  preblur: -20, upscale: 2, prenoise: 30, compression: 40, interpolation: 60
});

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-preparer-1981-"));
  const binary = join(directory, "ffprobe-fixture");
  await writeFile(binary, `#!/bin/sh\nprintf '%s' ${shellQuote(PROBE_JSON)}\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-topaz-enhance-owner-credential"); } };
}
function response(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
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

test("Topaz Enhance owned preparer and one-shot policy expose independent nominal APIs", () => {
  assert.ok(originalModule, "MISSING_OWNER_TOPAZ_ENHANCE_ORIGINAL_REFERENCE_SERVICE");
  assert.ok(preparerModule, "MISSING_OWNER_TOPAZ_ENHANCE_OWNED_REQUEST_PREPARER");
  assert.ok(policyModule, "MISSING_OWNER_TOPAZ_ENHANCE_OWNED_ONE_SHOT_POLICY");
  assert.equal(typeof preparerModule.createOwnerTopazEnhanceOwnedRequestPreparer, "function");
  assert.equal(typeof preparerModule.isOwnerTopazEnhanceOwnedPreparedCandidate, "function");
  for (const name of ["createOwnerTopazEnhanceOwnedOneShotPermit", "revalidateOwnerTopazEnhanceOwnedOneShotPermit", "consumeOwnerTopazEnhanceOwnedOneShotPermit"])
    assert.equal(typeof policyModule[name], "function", `missing export ${name}`);
});

test("a genuine uploaded original produces an exact URL-bound private request and one semantic permit", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN"); return; }
  assert.ok(originalModule, "1980 genuine original-reference service must be loaded for this behavior case");
  const fixture = await ffprobeFixture();
  const now = () => 1_000;
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B, ATTEMPT_C], now);
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
    return response({ files: [{ filename: "source.mp4", url: `https://r2.syntx.ai/topaz-enhance/hidden/original-${posts}.mp4`, status: "success",
      size: MP4.byteLength, content_type: "video/mp4", duration: 3 }] });
  } });
  const Service = originalModule.OwnerTopazEnhanceOriginalReferenceService as new (input: unknown) => {
    uploadOriginal(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    resolveOriginal(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  };
  const originalService = new Service({ ffprobePath: fixture.binary, destination: "hidden", binding: BINDING, linkService: links,
    resolveClient: () => client, now });
  let closePreparer: (() => Promise<void>) | undefined;
  try {
    const uploadedA = await originalService.uploadOriginal({ attemptId: ATTEMPT_A, model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: MP4 });
    const uploadedB = await originalService.uploadOriginal({ attemptId: ATTEMPT_B, model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: MP4 });
    const uploadedC = await originalService.uploadOriginal({ attemptId: ATTEMPT_C, model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: MP4 });
    assert.equal(posts, 3, "known-success original uploads on distinct attempts create fresh native handles");
    assert.notEqual(uploadedA.topaz_original_handle, uploadedB.topaz_original_handle);
    assert.notEqual(uploadedB.topaz_original_handle, uploadedC.topaz_original_handle);
    assert.ok(preparerModule && policyModule, "1981 owned preparer and one-shot policy must exist after genuine source uploads");
    const createPreparer = preparerModule!.createOwnerTopazEnhanceOwnedRequestPreparer as (input: unknown) => {
      prepare(input: unknown): Promise<OwnerTopazEnhanceOwnedPreparedCandidate>;
      inspectCandidate(candidate: unknown): Readonly<OwnerTopazEnhanceOwnedCandidateBinding> | undefined;
      getPrivateRequest(candidate: unknown): OwnerTopazEnhanceOwnedPreparedRequest;
      revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerTopazEnhanceOwnedCandidateBinding>>;
      invalidateAttempt(attemptId: string): Promise<void>;
      close(): Promise<void>;
    };
    const isCandidate = preparerModule!.isOwnerTopazEnhanceOwnedPreparedCandidate as (value: unknown) => boolean;
    const createPermit = policyModule!.createOwnerTopazEnhanceOwnedOneShotPermit as (input: unknown) => Promise<OwnerTopazEnhanceOwnedOneShotPermit>;
    const revalidatePermit = policyModule!.revalidateOwnerTopazEnhanceOwnedOneShotPermit as (input: unknown) => Promise<void>;
    const consumePermit = policyModule!.consumeOwnerTopazEnhanceOwnedOneShotPermit as (input: unknown) => OwnerTopazEnhanceOwnedOneShotPermitReceipt;
    const preparer = createPreparer({ originalReferenceService: originalService, now });
    closePreparer = () => preparer.close();
    const candidateA = await preparer.prepare({ attemptId: ATTEMPT_A, topaz_original_handle: uploadedA.topaz_original_handle,
      model_id: "topaz_enhance", parameters: PARAMETERS });
    const candidateB = await preparer.prepare({ attemptId: ATTEMPT_B, topaz_original_handle: uploadedB.topaz_original_handle,
      model_id: "topaz_enhance", parameters: PARAMETERS });
    const candidateC = await preparer.prepare({ attemptId: ATTEMPT_C, topaz_original_handle: uploadedC.topaz_original_handle,
      model_id: "topaz_enhance", parameters: PARAMETERS });
    assert.equal(isCandidate(candidateA), true);
    assert.equal(isCandidate({ ...candidateA }), false, "copied DTO is not a genuine candidate");
    assert.equal(candidateA.status, "blocked");
    assert.equal(candidateA.dispatch_allowed, false);
    assert.equal(candidateA.runtime_usable, false);
    assert.equal(candidateA.backend_acceptance, "UNPROVEN");
    assert.equal(candidateA.model_id, "topaz_enhance");
    assert.equal(candidateA.control_combination_status, "SOURCE_ENUMS_EXPLICIT_CONDITIONAL_COMBINATIONS_UNPROVEN");
    assert.equal(Object.isFrozen(candidateA), true);
    assert.equal(candidateA.source_binding.public_catalog_version, "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
    assert.equal(candidateA.source_binding.modules.app, "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175");
    assert.equal(candidateA.source_binding.modules.upscaler_page, "sha256:31d71db2e4f1b96517b2a4d34158290568a9e0253c87d8541ad492dcd2cf1c7b");
    assert.equal("topaz_original_handle" in candidateA, false);
    assert.equal(JSON.stringify(candidateA).includes("https://"), false);
    assert.equal(candidateA.intent_fingerprint, candidateB.intent_fingerprint, "semantic identity excludes attempt and native upload URL");
    assert.equal(candidateB.intent_fingerprint, candidateC.intent_fingerprint);
    const bindingA = preparer.inspectCandidate(candidateA)!;
    const bindingB = preparer.inspectCandidate(candidateB)!;
    assert.equal(bindingA.attempt_id, ATTEMPT_A);
    assert.equal(bindingA.principal.connection_id, ATTEMPT_A);
    assert.equal(Object.isFrozen(bindingA), true);
    assert.equal(bindingA.original_handle, uploadedA.topaz_original_handle);
    assert.equal(bindingA.original_sha256, uploadedA.sha256);
    assert.equal(bindingA.width, 640);
    assert.equal(bindingA.height, 360);
    assert.equal(bindingA.duration_seconds, 3);
    assert.equal(bindingA.frame_count, 90);
    assert.equal(bindingA.expires_at, 901_000);
    assert.notEqual(bindingA.request_fingerprint, bindingB.request_fingerprint, "request fingerprint binds the private native URL");
    const request = preparer.getPrivateRequest(candidateA);
    assert.deepEqual(Object.keys(request), ["settings"]);
    assert.deepEqual(request.settings, {
      model_type: "topaz_enhance", resolution: "2", video_duration: 3, width: 640, height: 360,
      parameters: { blur: -10, halo: 0, blend: 0, focus: "normal", grain: "off", model: "rhea-1", noise: 10,
        details: 20, preblur: -20, promode: 0, upscale: 2, prenoise: 30, compression: 40, interpolation: 60 },
      file_urls: [{ type: "video", url: "https://r2.syntx.ai/topaz-enhance/hidden/original-1.mp4" }]
    });
    assert.equal(Object.hasOwn(request, "prompt"), false);
    assert.equal(Object.hasOwn(request, "chat_id"), false);
    assert.equal(Object.hasOwn(request.settings, "n"), false);
    const principalA = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT_A });
    const principalB = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT_B });
    const principalC = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT_C });
    await assert.rejects(() => createPermit({ preparer, candidate: { ...candidateA }, principal: principalA, attemptId: ATTEMPT_A }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");
    await assert.rejects(() => createPermit({ preparer, candidate: candidateA, principal: principalB, attemptId: ATTEMPT_B }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
    const permitA = await createPermit({ preparer, candidate: candidateA, principal: principalA, attemptId: ATTEMPT_A });
    assert.equal(permitA.status, "nominal");
    assert.equal(permitA.dispatch_allowed, false);
    const permitB = await createPermit({ preparer, candidate: candidateB, principal: principalB, attemptId: ATTEMPT_B });
    assert.equal(permitB.status, "nominal", "unused preparation permits do not irreversibly claim a semantic intent");
    assert.throws(() => consumePermit({ permit: permitA, preparer, candidate: candidateA, principal: principalA, attemptId: ATTEMPT_A }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_NOT_REVALIDATED");
    await revalidatePermit({ permit: permitA, preparer, candidate: candidateA, principal: principalA, attemptId: ATTEMPT_A });
    assert.deepEqual(consumePermit({ permit: permitA, preparer, candidate: candidateA, principal: principalA, attemptId: ATTEMPT_A }),
      { status: "consumed", dispatch_allowed: false, request_fingerprint: candidateA.request_fingerprint });
    await assert.rejects(() => revalidatePermit({ permit: permitB, preparer, candidate: candidateB, principal: principalB, attemptId: ATTEMPT_B }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
    await assert.rejects(() => createPermit({ preparer, candidate: candidateC, principal: principalC, attemptId: ATTEMPT_C }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
    assert.throws(() => consumePermit({ permit: permitA, preparer, candidate: candidateA, principal: principalA, attemptId: ATTEMPT_A }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
    await originalService.invalidateAttempt(ATTEMPT_B);
    assert.equal(preparer.inspectCandidate(candidateB), undefined, "candidate is invalidated when its owner-bound original is revoked");
    await preparer.invalidateAttempt(ATTEMPT_A);
    assert.equal(preparer.inspectCandidate(candidateA), undefined);
  } finally { await closePreparer?.(); await originalService.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
