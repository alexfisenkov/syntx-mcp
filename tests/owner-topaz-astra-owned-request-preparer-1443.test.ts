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

test("genuine Topaz source UI admission binds one explicit request and one nominal receipt", async () => {
  assert.ok(preparerModule && policyModule, "Topaz owned preparer and one-shot policy modules must load");
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-owned-1443-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n");
  await chmod(ffprobe, 0o700);
  const links = await linkedOwner(ATTEMPTS);
  let preparerNow = 1_000;
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
  const revalidate = policyModule.revalidateOwnerTopazAstraOwnedOneShotPermit as (input: unknown) => Promise<void>;
  const preparer = createPreparer({ originalReferenceService: service, now: () => preparerNow });
  try {
    const candidates: OwnerTopazAstraOwnedPreparedCandidate[] = [];
    let ttlPermitContext: Record<string, unknown> | undefined;
    for (let index = 0; index < MODELS.length; index += 1) {
      const attemptId = ATTEMPTS[index]!;
      const modelId = MODELS[index]!;
      const resolution = index % 2 === 0 ? "1920x1080" as const : "3840x2160" as const;
      const uploaded = await service.uploadOriginal({ attemptId, model_id: modelId, filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
      if (index === 0) await assert.rejects(() => preparer.prepare({ attemptId, topaz_original_handle: uploaded.topaz_original_handle,
        model_id: modelId, parameters: { ...CONTROLS, frame_rate: 25 } }),
        (error: unknown) => error instanceof Error && error.name === "OwnerTopazAstraParametersError");
      const candidate = await preparer.prepare({ attemptId, topaz_original_handle: uploaded.topaz_original_handle,
        model_id: modelId, prompt: index === 2 ? "" : "Keep the motion natural.", parameters: { ...CONTROLS, resolution } });
      candidates.push(candidate);
      assert.equal(isCandidate(candidate), true);
      assert.equal(candidate.status, "blocked"); assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.control_combination_status, "SOURCE_UI_ENUMS_EXPLICIT_CONTROLS");
      assert.equal("prompt" in candidate, false); assert.equal("topaz_original_handle" in candidate, false);
      assert.equal(JSON.stringify(candidate).includes(SOURCE_URL), false);
      assert.equal(JSON.stringify(candidate).includes("Keep the motion natural."), false);
      const request = preparer.getPrivateRequest(candidate) as OwnerTopazAstraOwnedPreparedRequest;
      const expectsCreativity = modelId === "slc-1" || modelId === "slp-2.5";
      assert.equal(request.prompt, index === 2 ? undefined : "Keep the motion natural.");
      assert.equal(Object.hasOwn(request, "prompt"), index !== 2, "empty optional prompt is omitted from wire");
      assert.equal(Object.hasOwn(request.settings, "creativity"), expectsCreativity, `${modelId} creativity source predicate`);
      const expectedKeys = ["model_type", "video_duration", "resolution", "frame_rate", "slowmo",
        ...(expectsCreativity ? ["creativity"] : []), "file_urls"];
      assert.deepEqual(Object.keys(request.settings), expectedKeys, `${modelId} exact private settings fields`);
      assert.equal(Object.hasOwn(request.settings, "n"), false, `${modelId} custom payload omits sender store n`);
      assert.equal(request.settings.model_type, modelId);
      assert.deepEqual(request.settings.resolution, resolution === "1920x1080"
        ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 }, `${modelId} custom wire resolution metadata`);
      assert.equal(request.settings.video_duration, 3);
      assert.deepEqual(request.settings.file_urls, [{ type: "video", url: SOURCE_URL }]);
      assert.equal(request.settings.file_urls[0]?.type, "video", `${modelId} file_urls item retains its wire type`);
      const binding = preparer.inspectCandidate(candidate) as OwnerTopazAstraOwnedCandidateBinding;
      assert.equal(binding.principal.connection_id, attemptId); assert.equal(binding.original_sha256, uploaded.sha256);
      assert.deepEqual(candidate.source_binding, {
        public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
        settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
        source_build_id: "1791904852",
        topaz_astra_sha256: "sha256:1aecfac160b8512f77cef700edb30d9457cae2d20703f2727766a5f1947e3fac",
        upscaler3_sha256: "sha256:406fbed9c59ffe38d9e02e8475de2e26706a3a8b4f09fe839b3a29c5a8a43d55",
        admission_evidence: {
          status: "SOURCE_UI_ENUMS_EXPLICIT_CONTROLS",
          use_upscaler_tool_sha256: "sha256:bcdd047929542224ea0289fbc495a00ef22f53f5ca98be6b489b2c47885e8561",
          custom_settings_argument: 4,
          resolution_values: ["1920x1080", "3840x2160"],
          frame_rate_values: [24, 30, 60, 120],
          slowmo_values: [null, 2, 3, 4, 6, 8, 10, 12, 16],
          creativity_values: ["low", "middle", "high"],
          creativity_model_ids: ["slc-1", "slp-2.5"],
          empty_prompt: "OMITTED_FROM_WIRE",
          duration: "ROUNDED_FROM_PROBED_ORIGINAL",
          file_context: "OWNED_VIDEO_UPLOAD_REFERENCE"
        },
        request_projection: "SENDER_ARG4_CUSTOM_SETTINGS_NO_N_RESOLUTION_OBJECT"
      });
      assert.equal(Object.hasOwn(binding.parameters, "creativity"), expectsCreativity);
      assert.equal(isCandidate({ ...candidate }), false, "a copied public DTO is not an authentic candidate");
      const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId });
      await assert.rejects(() => createPermit({ preparer, candidate: { ...candidate }, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_UNBOUND");
      await assert.rejects(() => createPermit({ preparer, candidate, principal: snapshotGenerationPrincipal({
        tenant_id: BINDING.tenant_id, subject_id: "foreign-subject", connection_id: attemptId
      }), attemptId }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_MISMATCH");
      const permit = await createPermit({ preparer, candidate, principal, attemptId });
      await assert.rejects(() => createPermit({ preparer, candidate, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_ALREADY_ISSUED");
      assert.equal(permit.status, "nominal"); assert.equal(permit.dispatch_allowed, false); assert.equal(permit.backend_acceptance, "UNPROVEN");
      if (index === 3) {
        ttlPermitContext = { permit, preparer, candidate, principal, attemptId };
        continue;
      }
      assert.throws(() => consumePermit({ permit, preparer, candidate, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_NOT_REVALIDATED");
      await revalidate({ permit, preparer, candidate, principal, attemptId });
      const receipt = consumePermit({ permit, preparer, candidate, principal, attemptId }) as { status: string; dispatch_allowed: boolean };
      assert.deepEqual(receipt, { status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
      assert.throws(() => consumePermit({ permit, preparer, candidate, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
      assert.throws(() => consumePermit({ permit: {}, preparer, candidate, principal, attemptId }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_INVALID");
    }
    await preparer.invalidateAttempt(ATTEMPTS[0]);
    assert.equal(preparer.inspectCandidate(candidates[0]), undefined, "attempt epoch invalidates its candidate");
    preparerNow += 16 * 60_000;
    assert.equal(preparer.inspectCandidate(candidates[3]), undefined, "candidate expires at its source-reference/TTL bound");
    assert.ok(ttlPermitContext);
    await assert.rejects(() => revalidate(ttlPermitContext),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_EXPIRED");
  } finally { await preparer.close(); await service.close(); await rm(directory, { recursive: true, force: true }); }
});
