import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";
import type { OwnerTopazAstraOwnedCandidateBinding, OwnerTopazAstraOwnedPreparedCandidate,
  OwnerTopazAstraOwnedPreparedRequest, OwnerTopazAstraOwnedRequestPreparer } from "../src/application/owner-topaz-astra-owned-request-preparer.js";
import test from "node:test";

const MODULE_URL = new URL("../src/application/owner-topaz-astra-owned-request-preparer.js", import.meta.url).href;
const POLICY_URL = new URL("../src/application/owner-topaz-astra-owned-one-shot-policy.js", import.meta.url).href;
const preparerModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const policyModule = await import(POLICY_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPTS = ["link_topaz_owned_request_0123456789", "link_topaz_owned_request_1123456789",
  "link_topaz_owned_request_2123456789", "link_topaz_owned_request_3123456789"] as const;
const ATTEMPT = ATTEMPTS[0];
const MODELS = ["slc-1", "slf-2", "slp-2", "slp-2.5"] as const;
const BINDING = Object.freeze({ tenant_id: "topaz-owned-tenant", subject: "topaz-owned-subject" });
const SOURCE = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34]);
const SOURCE_URL = "https://r2.syntx.ai/topaz/owned/source.mp4";
const CONTROLS = Object.freeze({ resolution: "1920x1080" as const, frame_rate: 24 as const, slowmo: null, creativity: "middle" as const });

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-topaz-credential"); } };
}
function jsonResponse(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
async function linkedOwner(attemptIds: readonly string[] = [ATTEMPT]) {
  let nextAttempt = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-topaz-link-${nextAttempt}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const now = () => 1_000;
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => attemptIds[nextAttempt++]! });
  for (const attemptId of attemptIds) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId); }
  return links;
}

test("Topaz owned request preparation has an explicit non-dispatching nominal API", () => {
  assert.ok(preparerModule, "MISSING_OWNER_TOPAZ_ASTRA_OWNED_REQUEST_PREPARER");
  assert.equal(typeof preparerModule.createOwnerTopazAstraOwnedRequestPreparer, "function");
  assert.equal(typeof preparerModule.isOwnerTopazAstraOwnedPreparedCandidate, "function");
  assert.equal(typeof policyModule?.createOwnerTopazAstraOwnedOneShotPermit, "function");
  assert.equal(typeof policyModule?.revalidateOwnerTopazAstraOwnedOneShotPermit, "function");
  assert.equal(typeof policyModule?.consumeOwnerTopazAstraOwnedOneShotPermit, "function");
});

test("genuine Topaz original binds the private request and keeps unresolved control dispatch blocked", async () => {
  assert.ok(preparerModule && policyModule, "Topaz owned preparer and one-shot policy modules must load");
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-owned-1443-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n");
  await chmod(ffprobe, 0o700);
  const links = await linkedOwner(ATTEMPTS);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(new URL(String(input)).pathname, "/api/v1/chats/upload-files");
    assert.equal((init?.body as FormData).get("model_type") !== null, true);
    return jsonResponse({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success", size: SOURCE.byteLength,
      content_type: "video/mp4", duration: 3.2 }] });
  } });
  const Service = (await import("../src/application/owner-topaz-astra-original-reference-service.js")).OwnerTopazAstraOriginalReferenceService;
  const service = new Service({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING, linkService: links, resolveClient: () => client, now: () => 1_000 });
  const createPreparer = preparerModule.createOwnerTopazAstraOwnedRequestPreparer as (input: unknown) => OwnerTopazAstraOwnedRequestPreparer;
  const isCandidate = preparerModule.isOwnerTopazAstraOwnedPreparedCandidate as (value: unknown) => boolean;
  const createPermit = policyModule.createOwnerTopazAstraOwnedOneShotPermit as (input: unknown) => Promise<Record<string, unknown>>;
  const consumePermit = policyModule.consumeOwnerTopazAstraOwnedOneShotPermit as (input: unknown) => unknown;
  const preparer = createPreparer({ originalReferenceService: service, now: () => 1_000 });
  try {
    const candidates: OwnerTopazAstraOwnedPreparedCandidate[] = [];
    for (let index = 0; index < MODELS.length; index += 1) {
      const attemptId = ATTEMPTS[index]!;
      const modelId = MODELS[index]!;
      const uploaded = await service.uploadOriginal({ attemptId, model_id: modelId, filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
      if (index === 0) await assert.rejects(() => preparer.prepare({ attemptId, topaz_original_handle: uploaded.topaz_original_handle,
        model_id: modelId, parameters: { ...CONTROLS, frame_rate: 25 } }),
        (error: unknown) => error instanceof Error && error.name === "OwnerTopazAstraParametersError");
      const candidate = await preparer.prepare({ attemptId, topaz_original_handle: uploaded.topaz_original_handle,
        model_id: modelId, prompt: "Keep the motion natural.", parameters: CONTROLS });
      candidates.push(candidate);
      assert.equal(isCandidate(candidate), true);
      assert.equal(candidate.status, "blocked"); assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.control_combination_status, "UNRESOLVED");
      assert.equal("prompt" in candidate, false); assert.equal("topaz_original_handle" in candidate, false);
      assert.equal(JSON.stringify(candidate).includes(SOURCE_URL), false);
      assert.equal(JSON.stringify(candidate).includes("Keep the motion natural."), false);
      const request = preparer.getPrivateRequest(candidate) as OwnerTopazAstraOwnedPreparedRequest;
      const expectsCreativity = modelId === "slc-1" || modelId === "slp-2.5";
      assert.equal(request.prompt, "Keep the motion natural.");
      assert.equal(Object.hasOwn(request.settings, "creativity"), expectsCreativity, `${modelId} creativity source predicate`);
      const expectedKeys = ["n", "model_type", "resolution", "frame_rate", "slowmo", ...(expectsCreativity ? ["creativity"] : []),
        "video_duration", "file_urls"];
      assert.deepEqual(Object.keys(request.settings), expectedKeys, `${modelId} exact private settings fields`);
      assert.equal(request.settings.n, 1); assert.equal(request.settings.model_type, modelId);
      assert.equal(request.settings.video_duration, 3);
      assert.deepEqual(request.settings.file_urls, [{ type: "video", url: SOURCE_URL }]);
      const binding = preparer.inspectCandidate(candidate) as OwnerTopazAstraOwnedCandidateBinding;
      assert.equal(binding.principal.connection_id, attemptId); assert.equal(binding.original_sha256, uploaded.sha256);
      assert.equal(Object.hasOwn(binding.parameters, "creativity"), expectsCreativity);
      assert.equal(isCandidate({ ...candidate }), false, "a copied public DTO is not an authentic candidate");
      const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId });
      await assert.rejects(() => createPermit({ preparer, candidate, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTROL_COMBINATION_UNRESOLVED");
      assert.throws(() => consumePermit({ permit: {}, preparer, candidate, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_INVALID");
    }
    await service.invalidateAttempt(ATTEMPTS[0]);
    await assert.rejects(() => preparer.revalidateCandidate(candidates[0]!),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
  } finally { await preparer.close(); await service.close(); await rm(directory, { recursive: true, force: true }); }
});
